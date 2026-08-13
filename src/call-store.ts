import type { SatimOperation } from './operation.js';
import type { SatimResponse } from './response-reader.js';

/**
 * One recorded call to SATIM: what was sent, what came back, and what it meant.
 *
 * Written once before the request leaves and completed once when the answer
 * arrives, never edited afterwards, so a call that timed out still leaves
 * evidence. Nothing here belongs to the host application: only SATIM's own
 * identifiers and payloads.
 */
export interface SatimCallRecord {
  /** Correlates the row with the events that created and completed it. */
  callId: string;

  operation: SatimOperation;

  /** Present on register; SATIM's own id arrives with the response. */
  orderNumber: string | null;

  orderId: string | null;

  amountInCentimes: number | null;

  /** What was sent, with credentials redacted. */
  request: Record<string, string>;

  response: SatimResponse | null;

  /**
   * Null until the call finishes: the meaningful outcome of the call, not
   * merely whether a reply arrived.
   */
  successful: boolean | null;

  errorCode: string | null;

  errorMessage: string | null;

  orderStatus: number | null;

  /** Set only when no usable reply arrived at all. */
  failureReason: string | null;

  createdAt: Date;

  completedAt: Date | null;
}

/** What is known about a call before it is sent. */
export type SatimCallStarted = Pick<
  SatimCallRecord,
  'callId' | 'operation' | 'orderNumber' | 'orderId' | 'amountInCentimes' | 'request' | 'createdAt'
>;

/** What the gateway answered. */
export interface SatimCallCompletion {
  callId: string;
  orderId: string | null;
  response: SatimResponse;
  successful: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  orderStatus: number | null;
  completedAt: Date;
}

/** Which orders the reconciler should ask the gateway about. */
export interface SatimUnconfirmedCriteria {
  /** Only registers created at or before this instant. */
  registeredBefore: Date;

  /** Only registers created at or after this instant. */
  registeredAfter: Date;

  limit: number;
}

/**
 * Persistence for the audit trail.
 *
 * The only part of the package that touches a database, and the reason the core
 * imports no ORM: an application binds whichever implementation matches its own
 * stack under SATIM_CALL_STORE. Adapters for TypeORM and Prisma ship in the
 * "/typeorm" and "/prisma" entry points; the in-memory one below is the default.
 */
export interface SatimCallStore {
  /** Record the call before it is sent, so nothing can be lost in flight. */
  start(call: SatimCallStarted): Promise<void>;

  /**
   * Fill in the answer. The order id is written here too: on a register call it
   * does not exist until SATIM replies.
   */
  complete(completion: SatimCallCompletion): Promise<void>;

  /**
   * No usable answer arrived. The row stays without a completion time, which is
   * what marks it as needing a human to check with SATIM.
   */
  fail(callId: string, reason: string): Promise<void>;

  /** Whether this application has already sent that order number. */
  hasOrderNumber(orderNumber: string): Promise<boolean>;

  /** Every call recorded for one SATIM order, oldest first. */
  callsForOrder(orderId: string): Promise<SatimCallRecord[]>;

  /**
   * Registers that succeeded and that no completed acknowledge answers for.
   *
   * An acknowledge call that completed is an answer, whatever it said, so only
   * orders with none at all are returned. A call that never came back did not
   * complete, which is exactly the one worth trying again.
   */
  unconfirmed(criteria: SatimUnconfirmedCriteria): Promise<SatimCallRecord[]>;

  /** Delete rows created before this instant. Returns how many were deleted. */
  prune(before: Date): Promise<number>;
}

/**
 * The audit trail this package uses when an application binds nothing else.
 *
 * It keeps the trail in the process, so it is gone on restart. That is enough
 * for a test and never enough for production: SATIM may ask months later what
 * exactly was exchanged for a payment, and the evidence has to exist by then.
 */
export class InMemorySatimCallStore implements SatimCallStore {
  private readonly records: SatimCallRecord[] = [];

  /**
   * Every record, oldest first. Not part of the store contract: it exists so a
   * test can inspect a call that never reached the point of having an order id.
   */
  all(): SatimCallRecord[] {
    return [...this.records];
  }

  start(call: SatimCallStarted): Promise<void> {
    this.records.push({
      ...call,
      response: null,
      successful: null,
      errorCode: null,
      errorMessage: null,
      orderStatus: null,
      failureReason: null,
      completedAt: null,
    });

    return Promise.resolve();
  }

  complete(completion: SatimCallCompletion): Promise<void> {
    const record = this.records.find((candidate) => candidate.callId === completion.callId);

    if (record !== undefined) {
      record.orderId = completion.orderId ?? record.orderId;
      record.response = completion.response;
      record.successful = completion.successful;
      record.errorCode = completion.errorCode;
      record.errorMessage = completion.errorMessage;
      record.orderStatus = completion.orderStatus;
      record.completedAt = completion.completedAt;
    }

    return Promise.resolve();
  }

  fail(callId: string, reason: string): Promise<void> {
    const record = this.records.find((candidate) => candidate.callId === callId);

    if (record !== undefined) {
      record.successful = false;
      record.failureReason = reason;
    }

    return Promise.resolve();
  }

  hasOrderNumber(orderNumber: string): Promise<boolean> {
    return Promise.resolve(this.records.some((record) => record.orderNumber === orderNumber));
  }

  callsForOrder(orderId: string): Promise<SatimCallRecord[]> {
    return Promise.resolve(this.records.filter((record) => record.orderId === orderId));
  }

  unconfirmed(criteria: SatimUnconfirmedCriteria): Promise<SatimCallRecord[]> {
    const answered = new Set(
      this.records
        .filter(
          (record) =>
            record.operation === 'acknowledge' &&
            record.completedAt !== null &&
            record.orderId !== null,
        )
        .map((record) => record.orderId),
    );

    const unconfirmed = this.records
      .filter(
        (record) =>
          record.operation === 'register' &&
          record.successful === true &&
          record.orderId !== null &&
          record.createdAt <= criteria.registeredBefore &&
          record.createdAt >= criteria.registeredAfter &&
          !answered.has(record.orderId),
      )
      .slice(0, criteria.limit);

    return Promise.resolve(unconfirmed);
  }

  prune(before: Date): Promise<number> {
    const kept = this.records.filter((record) => record.createdAt >= before);
    const deleted = this.records.length - kept.length;

    this.records.length = 0;
    this.records.push(...kept);

    return Promise.resolve(deleted);
  }
}

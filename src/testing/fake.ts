import { endpointFor, SatimOperation } from '../operation.js';
import type { SatimResponse } from '../response-reader.js';
import type { SatimTransport } from '../transport.js';
import { SatimFakeResponse } from './fake-response.js';
import { SatimRecordedCall } from './recorded-call.js';

export type SatimCallMatcher = (call: SatimRecordedCall) => boolean;

/** Answers queued per operation, keyed by operation value. */
export type SatimFakeResponses = Partial<
  Record<SatimOperation, SatimFakeResponse | SatimFakeResponse[]>
>;

/**
 * Stands in for the gateway during a test.
 *
 * Bind it under SATIM_TRANSPORT and it replaces the transport and nothing else:
 * the amount conversion, the order number and udf validation, the events, and
 * the audit trail all still run, so a test cannot pass on a call that
 * production would refuse to send.
 *
 * Responses are queued per operation. A queue with several entries is consumed
 * one call at a time and its last entry then answers every further call, which
 * is what a reconciliation loop calling acknowledge twice needs.
 *
 * The assertions throw a plain Error, so they fail a test under any runner
 * without this package depending on one.
 */
export class SatimFake implements SatimTransport {
  private readonly responses = new Map<SatimOperation, SatimFakeResponse[]>();

  private readonly calls: SatimRecordedCall[] = [];

  /**
   * @param responses Keyed by operation. An operation left out answers with a success.
   */
  constructor(responses: SatimFakeResponses = {}) {
    for (const [operation, response] of Object.entries(responses)) {
      this.responses.set(
        operation as SatimOperation,
        Array.isArray(response) ? [...response] : [response],
      );
    }
  }

  /** Answer the call as the gateway would have, and remember it. */
  post(operation: SatimOperation, payload: Record<string, string>): Promise<SatimResponse> {
    const response = this.next(operation);

    this.calls.push(
      new SatimRecordedCall(
        operation,
        endpointFor(operation),
        { ...payload, userName: '[REDACTED]', password: '[REDACTED]' },
        response.body,
      ),
    );

    if (response.error !== null) {
      return Promise.reject(response.error);
    }

    return Promise.resolve(response.body);
  }

  /** The calls made, optionally narrowed to one operation. */
  recorded(operation?: SatimOperation, matcher?: SatimCallMatcher): SatimRecordedCall[] {
    return this.calls.filter(
      (call) =>
        (operation === undefined || call.operation === operation) &&
        (matcher === undefined || matcher(call)),
    );
  }

  /** An order was registered, optionally one the matcher accepts. */
  assertRegistered(matcher?: SatimCallMatcher): this {
    return this.assertSent(SatimOperation.Register, matcher);
  }

  /** A payment outcome was confirmed, optionally for one order id. */
  assertAcknowledged(orderId?: string | SatimCallMatcher): this {
    return this.assertSent(SatimOperation.Acknowledge, toMatcher(orderId));
  }

  /**
   * A refund was requested, optionally for one order id and amount.
   *
   * @param amount Amount in DZD, compared against the centimes that were sent.
   */
  assertRefunded(orderId?: string | SatimCallMatcher, amount?: number): this {
    const matcher = toMatcher(orderId);
    const centimes = amount === undefined ? null : Math.round(amount * 100);

    return this.assertSent(
      SatimOperation.Refund,
      (call) =>
        (matcher === undefined || matcher(call)) &&
        (centimes === null || call.amountInCentimes() === centimes),
    );
  }

  /** The operation was called at least once, optionally with a matching payload. */
  assertSent(operation: SatimOperation, matcher?: SatimCallMatcher): this {
    if (this.recorded(operation, matcher).length === 0) {
      throw new Error(`The SATIM [${operation}] call was not sent.`);
    }

    return this;
  }

  /** The operation was never called, or never with a matching payload. */
  assertNotSent(operation: SatimOperation, matcher?: SatimCallMatcher): this {
    if (this.recorded(operation, matcher).length > 0) {
      throw new Error(`The SATIM [${operation}] call was sent, and was not expected to be.`);
    }

    return this;
  }

  /** Nothing reached the gateway, which is what a rejected input must produce. */
  assertNothingSent(): this {
    if (this.calls.length > 0) {
      throw new Error('SATIM calls were sent, and none were expected.');
    }

    return this;
  }

  /** Exactly this many calls were made, across every operation. */
  assertSentCount(count: number): this {
    if (this.calls.length !== count) {
      throw new Error(
        `SATIM received ${this.calls.length} calls, and exactly ${count} were expected.`,
      );
    }

    return this;
  }

  /**
   * The answer for this call: queued entries are consumed in order, and the
   * last one is kept so a repeated call still gets an answer.
   */
  private next(operation: SatimOperation): SatimFakeResponse {
    const queue = this.responses.get(operation) ?? [];

    if (queue.length === 0) {
      return defaultResponse(operation);
    }

    if (queue.length > 1) {
      return queue.shift() as SatimFakeResponse;
    }

    return queue[0] as SatimFakeResponse;
  }
}

function toMatcher(orderId: string | SatimCallMatcher | undefined): SatimCallMatcher | undefined {
  if (orderId === undefined || typeof orderId === 'function') {
    return orderId;
  }

  return (call) => call.orderId() === orderId;
}

/**
 * What an operation answers when the test did not stage anything: a plain
 * success, so a test about something else does not have to describe one.
 */
function defaultResponse(operation: SatimOperation): SatimFakeResponse {
  switch (operation) {
    case SatimOperation.Register:
      return SatimFakeResponse.registered();
    case SatimOperation.Acknowledge:
      return SatimFakeResponse.paid();
    case SatimOperation.Refund:
      return SatimFakeResponse.refunded();
  }
}

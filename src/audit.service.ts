import { Inject, Injectable } from '@nestjs/common';

import type { SatimCallRecord, SatimCallStore, SatimUnconfirmedCriteria } from './call-store.js';
import type {
  SatimCallCompletedEvent,
  SatimCallFailedEvent,
  SatimCallStartedEvent,
} from './events.js';
import type { ResolvedSatimOptions } from './options.js';
import { SatimOrderState } from './results/order-state.js';
import { SATIM_CALL_STORE, SATIM_OPTIONS } from './tokens.js';

/**
 * The audit trail: one record per gateway call, and the questions asked of it.
 *
 * Every method checks whether recording is switched on rather than deciding
 * once at boot, so changing the setting takes effect at once and a disabled
 * trail touches the store not at all.
 */
@Injectable()
export class SatimAuditService {
  constructor(
    @Inject(SATIM_OPTIONS) private readonly options: ResolvedSatimOptions,
    @Inject(SATIM_CALL_STORE) private readonly store: SatimCallStore,
  ) {}

  get enabled(): boolean {
    return this.options.audit.enabled;
  }

  /** Record the call before it is sent, so nothing can be lost in flight. */
  async started(event: SatimCallStartedEvent, at: Date): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.store.start({
      callId: event.callId,
      operation: event.operation,
      orderNumber: event.orderNumber,
      orderId: event.orderId,
      amountInCentimes: event.amountInCentimes,
      request: event.payload,
      createdAt: at,
    });
  }

  async completed(event: SatimCallCompletedEvent, at: Date): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.store.complete({
      callId: event.callId,
      orderId: event.orderId,
      response: event.response,
      successful: event.successful,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      orderStatus: event.orderStatus,
      completedAt: at,
    });
  }

  /**
   * The record stays without a completion time, which is what marks it as
   * needing a human to check with SATIM.
   */
  async failed(event: SatimCallFailedEvent): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await this.store.fail(event.callId, event.reason);
  }

  /**
   * Whether this application has already sent that order number.
   *
   * The audit trail is the only record the package has of what it sent, so with
   * the trail switched off there is nothing to check against and every number
   * is treated as free.
   */
  async hasOrderNumber(orderNumber: string): Promise<boolean> {
    return this.enabled ? this.store.hasOrderNumber(orderNumber) : false;
  }

  /** Everything recorded for one SATIM order, oldest call first. */
  async stateFor(orderId: string): Promise<SatimOrderState> {
    return new SatimOrderState(
      orderId,
      this.enabled ? await this.store.callsForOrder(orderId) : [],
    );
  }

  async unconfirmed(criteria: SatimUnconfirmedCriteria): Promise<SatimCallRecord[]> {
    return this.enabled ? this.store.unconfirmed(criteria) : [];
  }

  /**
   * Delete records past the retention period, and report how many went.
   *
   * A retention of null keeps everything, and nothing is deleted at all unless
   * this is called: schedule it yourself.
   */
  async prune(now: Date = new Date()): Promise<number> {
    const days = this.options.audit.retentionDays;

    if (!this.enabled || days === null) {
      return 0;
    }

    return this.store.prune(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
  }
}

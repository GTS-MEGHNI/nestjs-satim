import type { SatimCallRecord } from '../call-store.js';
import { SatimOperation } from '../operation.js';
import { type SatimOrderStatus, toSatimOrderStatus } from '../order-status.js';

/**
 * Where an order stands, worked out from the calls recorded against it.
 *
 * Nothing is stored twice: there is no status column that could disagree with
 * the log, and a failed call is part of the picture rather than an absence.
 */
export class SatimOrderState {
  /**
   * @param calls Every recorded call, oldest first.
   */
  constructor(
    readonly orderId: string,
    readonly calls: SatimCallRecord[],
  ) {}

  /** SATIM accepted the order and gave it an identifier. */
  registered(): boolean {
    return this.successful(SatimOperation.Register).length > 0;
  }

  /** The outcome was confirmed with SATIM, whatever that outcome was. */
  acknowledged(): boolean {
    return this.completed(SatimOperation.Acknowledge).length > 0;
  }

  /** The customer paid and the money was deposited. */
  paid(): boolean {
    return this.successful(SatimOperation.Acknowledge).length > 0;
  }

  /** At least one refund went through, whether partial or in full. */
  refunded(): boolean {
    return this.successful(SatimOperation.Refund).length > 0;
  }

  /** Total returned so far, which SATIM caps at the amount deposited. */
  refundedInCentimes(): number {
    return this.successful(SatimOperation.Refund).reduce(
      (total, refund) => total + (refund.amountInCentimes ?? 0),
      0,
    );
  }

  /** The last status SATIM reported, or null if it never reported one. */
  orderStatus(): SatimOrderStatus | null {
    const withStatus = this.completed(SatimOperation.Acknowledge)
      .toReversed()
      .find((call) => call.orderStatus !== null);

    return toSatimOrderStatus(withStatus?.orderStatus ?? null);
  }

  /**
   * Calls that were sent but never came back, which are the ones worth chasing:
   * money may have moved without your application hearing about it.
   */
  unanswered(): SatimCallRecord[] {
    return this.calls.filter((call) => call.completedAt === null);
  }

  lastCallAt(): Date | null {
    return this.calls.at(-1)?.createdAt ?? null;
  }

  private successful(operation: SatimOperation): SatimCallRecord[] {
    return this.calls.filter((call) => call.operation === operation && call.successful === true);
  }

  private completed(operation: SatimOperation): SatimCallRecord[] {
    return this.calls.filter((call) => call.operation === operation && call.completedAt !== null);
  }
}

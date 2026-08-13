import type { SatimOperation } from '../operation.js';
import type { SatimResponse } from '../response-reader.js';

/** One gateway call a test made while the fake was installed. */
export class SatimRecordedCall {
  constructor(
    readonly operation: SatimOperation,
    readonly endpoint: string,
    /** What was sent, with credentials redacted. */
    readonly payload: Record<string, string>,
    /** What the fake answered, empty when it raised a connection failure. */
    readonly response: SatimResponse = {},
  ) {}

  /** The order number, on the register call that carries one. */
  orderNumber(): string | null {
    return this.payload['orderNumber'] ?? null;
  }

  /**
   * The order id, under whichever name the endpoint gives it: acknowledge sends
   * mdOrder, refund sends orderId, and register has none yet.
   */
  orderId(): string | null {
    return this.payload['mdOrder'] ?? this.payload['orderId'] ?? null;
  }

  /** The amount in centimes, as SATIM was asked for it. */
  amountInCentimes(): number | null {
    const value = this.payload['amount'];

    return value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  }

  /** The jsonParams SATIM was sent, decoded. */
  jsonParams(): Record<string, string> {
    const value = this.payload['jsonParams'];

    if (value === undefined) {
      return {};
    }

    return JSON.parse(value) as Record<string, string>;
  }
}

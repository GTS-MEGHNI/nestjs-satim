import { type SatimErrorCode, toSatimErrorCode } from '../error-code.js';
import {
  isCancelledStatus,
  isRefundedStatus,
  type SatimOrderStatus,
  toSatimOrderStatus,
} from '../order-status.js';
import { intValue, paramsOf, type SatimResponse, stringValue } from '../response-reader.js';

/** The only respCode, errorCode and orderStatus that mean the money moved. */
const PAID_RESP_CODE = '00';
const PAID_ERROR_CODE = '0';
const PAID_ORDER_STATUS = 2;

/** Authorisation reversed: SATIM reports no error, yet the payment failed. */
const REVERSED_ORDER_STATUS = 3;

/**
 * Outcome of a call to the SATIM acknowledge endpoint.
 *
 * Whether the customer actually paid is decided by three fields read together,
 * never by one alone: respCode, errorCode and orderStatus.
 */
export class AcknowledgeResult {
  private constructor(
    /** Taken from the request: SATIM does not echo it back. */
    readonly orderId: string,
    /** Outcome text to persist, per the SATIM integration guide. */
    readonly message: string | null,
    readonly respCode: string | null,
    /** SATIM's own wording, untouched. */
    readonly respCodeDesc: string | null,
    readonly actionCode: string | null,
    readonly actionCodeDescription: string | null,
    readonly errorCode: string | null,
    readonly errorMessage: string | null,
    /** The raw status number SATIM sent. */
    readonly orderStatus: number | null,
    /** The named order status, null when SATIM sent one this package does not know. */
    readonly status: SatimOrderStatus | null,
    readonly orderNumber: string | null,
    /** Amount as SATIM sent it. */
    readonly amountInCentimes: number | null,
    /** The same amount in dinars. */
    readonly amount: number | null,
    readonly maskedCard: string | null,
    readonly cardholderName: string | null,
    readonly expiration: string | null,
    readonly approvalCode: string | null,
    readonly currency: string | null,
    readonly ip: string | null,
    /** Payload sent to SATIM, with credentials redacted. */
    readonly rawRequest: Record<string, string>,
    /** Decoded SATIM response, verbatim. */
    readonly rawResponse: SatimResponse,
  ) {}

  /**
   * @param reversalMessage Localised wording required when the authorisation was reversed.
   */
  static fromResponse(
    orderId: string,
    response: SatimResponse,
    rawRequest: Record<string, string>,
    reversalMessage: string,
  ): AcknowledgeResult {
    const params = paramsOf(response);
    const amountInCentimes = intValue(response, 'Amount');
    const orderStatus = intValue(response, 'OrderStatus');

    return new AcknowledgeResult(
      orderId,
      AcknowledgeResult.message(response, params, reversalMessage),
      stringValue(params, 'respCode'),
      stringValue(params, 'respCode_desc'),
      stringValue(response, 'actionCode'),
      stringValue(response, 'actionCodeDescription'),
      stringValue(response, 'ErrorCode'),
      stringValue(response, 'ErrorMessage'),
      orderStatus,
      toSatimOrderStatus(orderStatus),
      stringValue(response, 'OrderNumber'),
      amountInCentimes,
      amountInCentimes === null ? null : amountInCentimes / 100,
      stringValue(response, 'Pan'),
      stringValue(response, 'cardholderName'),
      stringValue(response, 'expiration'),
      stringValue(response, 'approvalCode') ?? stringValue(response, 'authorizationResponseId'),
      stringValue(response, 'currency'),
      stringValue(response, 'Ip'),
      rawRequest,
      response,
    );
  }

  /**
   * The named error code, or null when SATIM sent one this package does not
   * know. The raw value stays on errorCode either way.
   */
  error(): SatimErrorCode | null {
    return toSatimErrorCode(this.errorCode);
  }

  /** The customer paid and the amount was deposited. */
  paid(): boolean {
    return (
      this.respCode === PAID_RESP_CODE &&
      this.errorCode === PAID_ERROR_CODE &&
      this.orderStatus === PAID_ORDER_STATUS
    );
  }

  rejected(): boolean {
    return !this.paid();
  }

  /** Refunded by staff in SATIM's back office. */
  refunded(): boolean {
    return isRefundedStatus(this.status);
  }

  /** Cancelled by staff in SATIM's back office. */
  cancelled(): boolean {
    return isCancelledStatus(this.status);
  }

  /**
   * Outcome text, following the mapping in the SATIM integration guide.
   *
   * SATIM's own description is used throughout, except for a reversed
   * authorisation, where the guide mandates fixed localised wording because the
   * gateway itself reports no error.
   */
  private static message(
    response: SatimResponse,
    params: SatimResponse,
    reversalMessage: string,
  ): string | null {
    const reported =
      stringValue(params, 'respCode_desc') ?? stringValue(response, 'actionCodeDescription');

    const isReversed =
      stringValue(params, 'respCode') === PAID_RESP_CODE &&
      stringValue(response, 'ErrorCode') === PAID_ERROR_CODE &&
      intValue(response, 'OrderStatus') === REVERSED_ORDER_STATUS;

    return isReversed ? reversalMessage : reported;
  }
}

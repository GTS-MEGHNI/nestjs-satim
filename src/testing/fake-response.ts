import { SatimConnectionError } from '../errors.js';
import { SatimOrderStatus } from '../order-status.js';
import { DZD_CURRENCY } from '../options.js';
import type { SatimResponse } from '../response-reader.js';

/**
 * A canned SATIM answer for use with SatimFake.
 *
 * The named constructors exist so a test never has to know SATIM's field names,
 * its mixed value types, or which combination of respCode, ErrorCode and
 * OrderStatus means the money moved. Pass overrides for the fields a given test
 * is actually about, or build the whole body with make().
 */
export class SatimFakeResponse {
  private constructor(
    /** The decoded body the fake returns. */
    readonly body: SatimResponse,
    /** Thrown instead of answering, when set. */
    readonly error: SatimConnectionError | null = null,
  ) {}

  /** A response body written out in full. */
  static make(body: SatimResponse): SatimFakeResponse {
    return new SatimFakeResponse(body);
  }

  /** The order was registered and the customer can be sent to the form. */
  static registered(
    orderId = 'V721uPPfNNofVQAAABL3',
    formUrl?: string,
    overrides: SatimResponse = {},
  ): SatimFakeResponse {
    return new SatimFakeResponse({
      errorCode: '0',
      orderId,
      formUrl:
        formUrl ??
        `https://test.satim.dz/payment/merchants/merchantsatim/payment.html?mdOrder=${orderId}`,
      ...overrides,
    });
  }

  /** SATIM turned the registration down: no orderId, so no payment page. */
  static registerFailed(
    errorCode = '1',
    errorMessage = 'Order with given order number is already processed',
    overrides: SatimResponse = {},
  ): SatimFakeResponse {
    return new SatimFakeResponse({ errorCode, errorMessage, ...overrides });
  }

  /** The customer paid and the amount was deposited. */
  static paid(
    amount = 1000,
    orderNumber = 'K9m2X7qL4P',
    approvalCode = '913180',
    maskedCard = '6280****7215',
    message = 'Votre paiement a été accepté',
    overrides: SatimResponse = {},
  ): SatimFakeResponse {
    return new SatimFakeResponse({
      ...acknowledgeBody(amount, orderNumber, message),
      approvalCode,
      authorizationResponseId: approvalCode,
      Pan: maskedCard,
      ...overrides,
    });
  }

  /**
   * The payment was refused, which SATIM reports through respCode rather than
   * through a transport error.
   */
  static declined(
    respCode = '05',
    message = 'Votre transaction a été rejetée',
    amount = 1000,
    orderNumber = 'K9m2X7qL4P',
    overrides: SatimResponse = {},
  ): SatimFakeResponse {
    return new SatimFakeResponse({
      ...acknowledgeBody(amount, orderNumber, message),
      actionCode: -1,
      OrderStatus: SatimOrderStatus.AuthorisationDeclined,
      params: { respCode, respCode_desc: message },
      ...overrides,
    });
  }

  /**
   * The authorisation was reversed: SATIM reports no error of its own, so the
   * package supplies the wording the integration guide mandates.
   */
  static reversed(
    amount = 1000,
    orderNumber = 'K9m2X7qL4P',
    overrides: SatimResponse = {},
  ): SatimFakeResponse {
    return new SatimFakeResponse({
      ...acknowledgeBody(amount, orderNumber, 'Votre paiement a été accepté'),
      OrderStatus: SatimOrderStatus.Reversed,
      ...overrides,
    });
  }

  /** The order was refunded, whether from refund.do or from the back office. */
  static acknowledgeRefunded(
    amount = 1000,
    orderNumber = 'K9m2X7qL4P',
    overrides: SatimResponse = {},
  ): SatimFakeResponse {
    return new SatimFakeResponse({
      ...acknowledgeBody(amount, orderNumber, 'Votre paiement a été accepté'),
      OrderStatus: SatimOrderStatus.Refunded,
      ...overrides,
    });
  }

  /** The money was returned to the customer. */
  static refunded(overrides: SatimResponse = {}): SatimFakeResponse {
    return new SatimFakeResponse({ errorCode: '0', ...overrides });
  }

  /** SATIM refused the refund, which it reports with a non-zero code. */
  static refundFailed(
    errorCode = '7',
    errorMessage = 'Payment must be in a correct state',
    overrides: SatimResponse = {},
  ): SatimFakeResponse {
    return new SatimFakeResponse({ errorCode, errorMessage, ...overrides });
  }

  /** The gateway could not be reached, so the call throws instead of answering. */
  static connectionFailure(message = 'The operation timed out'): SatimFakeResponse {
    return new SatimFakeResponse({}, new SatimConnectionError(message));
  }
}

/**
 * Fields every acknowledge answer carries, set to the accepted combination. The
 * callers above override only what makes their own case different.
 */
function acknowledgeBody(amount: number, orderNumber: string, message: string): SatimResponse {
  const amountInCentimes = Math.round(amount * 100);

  return {
    ErrorCode: '0',
    ErrorMessage: 'Success',
    OrderStatus: SatimOrderStatus.Deposited,
    OrderNumber: orderNumber,
    Amount: amountInCentimes,
    depositAmount: amountInCentimes,
    currency: DZD_CURRENCY,
    actionCode: 0,
    actionCodeDescription: message,
    approvalCode: '913180',
    authorizationResponseId: '913180',
    Pan: '6280****7215',
    cardholderName: 'CARDHOLDER NAME',
    expiration: '202701',
    Ip: '10.12.12.14',
    params: {
      respCode: '00',
      respCode_desc: message,
      udf1: orderNumber,
    },
    SvfeResponse: '00',
  };
}

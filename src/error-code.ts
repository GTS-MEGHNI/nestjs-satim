import { SatimOperation } from './operation.js';

/**
 * Error codes SATIM returns, as listed in the integration guide.
 *
 * The same number does not mean the same thing on every endpoint: 2 is only
 * ever returned by acknowledge, 1, 3, 4 and 14 only by register, and 5 and 7
 * cover different faults depending on the call. Read a code through
 * describeErrorCode(), which asks for the operation for that reason.
 *
 * SATIM also sends its own message, in the language of the request. That text
 * is what a customer should see; this is for deciding what your code does next.
 * A code outside this list leaves the raw value untouched on the result.
 */
export const SatimErrorCode = {
  /** No system error: the call did what it was asked. */
  None: '0',

  /** Register only: the order number was already used, or the submerchant is blocked. */
  OrderAlreadyProcessed: '1',

  /** Acknowledge only: the payment was declined over the card credentials. */
  Declined: '2',

  /** Register only: the currency is not one SATIM knows. */
  UnknownCurrency: '3',

  /** Register only: a mandatory parameter was not sent at all. */
  MissingParameter: '4',

  /** A parameter value was refused, or the merchant may not make this call. */
  InvalidParameter: '5',

  /** No order exists for the id that was sent. */
  UnknownOrder: '6',

  /** A fault on SATIM's side, or an order in a state the call does not allow. */
  SystemError: '7',

  /** Register only: the payment way is not valid. */
  InvalidPaymentWay: '14',
} as const;

export type SatimErrorCode = (typeof SatimErrorCode)[keyof typeof SatimErrorCode];

const KNOWN = new Set<string>(Object.values(SatimErrorCode));

/**
 * The named code, or null when SATIM sent one this package does not know. The
 * raw value stays on the result either way.
 */
export function toSatimErrorCode(value: string | null): SatimErrorCode | null {
  return value !== null && KNOWN.has(value) ? (value as SatimErrorCode) : null;
}

/**
 * The gateway reported no error.
 *
 * On register and refund this is the success criterion. On acknowledge it is
 * not: a payment can be declined while the call itself succeeded, which is why
 * AcknowledgeResult reads three fields rather than this one.
 */
export function isSuccessfulErrorCode(code: SatimErrorCode): boolean {
  return code === SatimErrorCode.None;
}

/**
 * Code 5 is the busiest one, and its list differs on every endpoint.
 */
function invalidParameterDescription(operation: SatimOperation): string {
  switch (operation) {
    case SatimOperation.Register:
      return 'Incorrect value of a request parameter, an incorrect language, invalid jsonParams, access denied, or the merchant must change the password.';
    case SatimOperation.Acknowledge:
      return 'Access denied, the user must change the password, or the order id was empty.';
    case SatimOperation.Refund:
      return 'Access denied, the user must change the password, or the refund amount is not allowed.';
  }
}

/**
 * What SATIM's guide says this code means on that call.
 *
 * Several codes cover more than one fault, and the guide lists them all, so the
 * wording here names each of them.
 */
export function describeErrorCode(code: SatimErrorCode, operation: SatimOperation): string {
  switch (code) {
    case SatimErrorCode.None:
      return 'No system error.';
    case SatimErrorCode.OrderAlreadyProcessed:
      return 'The order number was already processed, or was registered and not paid, or the submerchant is blocked or deleted.';
    case SatimErrorCode.Declined:
      return 'The order was declined because of an error in the payment credentials.';
    case SatimErrorCode.UnknownCurrency:
      return 'Unknown currency.';
    case SatimErrorCode.MissingParameter:
      return 'A mandatory parameter was not specified: order number, merchant user name, amount, return URL, or password.';
    case SatimErrorCode.InvalidParameter:
      return invalidParameterDescription(operation);
    case SatimErrorCode.UnknownOrder:
      return 'Unregistered order id.';
    case SatimErrorCode.SystemError:
      return operation === SatimOperation.Refund
        ? 'System error, or the payment is not in a state that allows a refund.'
        : 'System error.';
    case SatimErrorCode.InvalidPaymentWay:
      return 'The payment way is invalid.';
  }
}

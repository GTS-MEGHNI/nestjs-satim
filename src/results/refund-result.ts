import { type SatimErrorCode, toSatimErrorCode } from '../error-code.js';
import { type SatimResponse, stringValue } from '../response-reader.js';

/** The only code that means money was returned to the customer. */
const SUCCESS_ERROR_CODE = '0';

/**
 * Outcome of a call to the SATIM refund endpoint.
 *
 * Unlike register, success here is an errorCode of 0: there is no identifier to
 * look for. A refund SATIM turned down is a normal outcome rather than a thrown
 * error, so check successful() and keep both payloads.
 */
export class RefundResult {
  private constructor(
    /** Taken from the request: SATIM returns only a code. */
    readonly orderId: string,
    /** Amount refunded, as sent to SATIM. */
    readonly amountInCentimes: number,
    /** The same amount in dinars. */
    readonly amount: number,
    readonly errorCode: string | null,
    readonly errorMessage: string | null,
    /** Payload sent to SATIM, with credentials redacted. */
    readonly rawRequest: Record<string, string>,
    /** Decoded SATIM response, verbatim. */
    readonly rawResponse: SatimResponse,
  ) {}

  static fromResponse(
    orderId: string,
    amountInCentimes: number,
    response: SatimResponse,
    rawRequest: Record<string, string>,
  ): RefundResult {
    return new RefundResult(
      orderId,
      amountInCentimes,
      amountInCentimes / 100,
      stringValue(response, 'errorCode'),
      stringValue(response, 'errorMessage'),
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

  /**
   * The money was returned.
   *
   * A missing code counts as a failure: on something this consequential, an
   * answer the package cannot read is not treated as a success.
   */
  successful(): boolean {
    return this.errorCode === SUCCESS_ERROR_CODE;
  }

  failed(): boolean {
    return !this.successful();
  }
}

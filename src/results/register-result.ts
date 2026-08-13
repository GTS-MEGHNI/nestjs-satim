import { type SatimErrorCode, toSatimErrorCode } from '../error-code.js';
import { type SatimResponse, stringValue } from '../response-reader.js';

/**
 * Outcome of a call to the SATIM register endpoint.
 *
 * A gateway-side rejection (duplicate order number, blocked merchant, ...) is a
 * normal outcome rather than a thrown error: check successful() and persist the
 * raw payloads, which SATIM may ask for during certification or an audit.
 */
export class RegisterResult {
  private constructor(
    readonly orderId: string | null,
    readonly formUrl: string | null,
    readonly errorCode: string | null,
    readonly errorMessage: string | null,
    /** Payload sent to SATIM, with credentials redacted. */
    readonly rawRequest: Record<string, string>,
    /** Decoded SATIM response, verbatim. */
    readonly rawResponse: SatimResponse,
  ) {}

  static fromResponse(response: SatimResponse, rawRequest: Record<string, string>): RegisterResult {
    return new RegisterResult(
      stringValue(response, 'orderId'),
      stringValue(response, 'formUrl'),
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
   * SATIM registered the order: the documented success criterion is the
   * presence of an orderId.
   */
  successful(): boolean {
    return this.orderId !== null;
  }

  failed(): boolean {
    return !this.successful();
  }
}

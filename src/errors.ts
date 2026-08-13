/** Base of every error this package throws, so one catch can cover the package. */
export class SatimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The gateway could not be reached, or answered unusably.
 *
 * A SATIM response carrying an error code is NOT a connection failure: those
 * are reported through the result objects instead.
 */
export class SatimConnectionError extends SatimError {
  constructor(
    message: string,
    readonly url: string | null = null,
    override readonly cause?: unknown,
  ) {
    super(message);
  }

  static requestFailed(url: string, cause: unknown): SatimConnectionError {
    const reason = cause instanceof Error ? cause.message : String(cause);

    return new SatimConnectionError(
      `The request to the SATIM gateway [${url}] failed: ${reason}`,
      url,
      cause,
    );
  }

  static unexpectedStatus(url: string, status: number): SatimConnectionError {
    return new SatimConnectionError(
      `The SATIM gateway [${url}] responded with HTTP status ${status}.`,
      url,
    );
  }

  static invalidResponse(url: string): SatimConnectionError {
    return new SatimConnectionError(
      `The SATIM gateway [${url}] did not return a JSON object.`,
      url,
    );
  }
}

/**
 * The module was configured with incomplete or invalid options.
 */
export class SatimConfigurationError extends SatimError {
  static missing(key: string): SatimConfigurationError {
    return new SatimConfigurationError(
      `The SATIM configuration value [${key}] is required but missing.`,
    );
  }

  static invalid(key: string, reason: string): SatimConfigurationError {
    return new SatimConfigurationError(
      `The SATIM configuration value [${key}] is invalid: ${reason}`,
    );
  }
}

/**
 * Arguments would violate a documented SATIM request constraint.
 *
 * These are caught before any HTTP call, so the gateway never has to reject the
 * request for a rule the package can check locally.
 */
export class SatimValidationError extends SatimError {
  static orderNumber(orderNumber: string): SatimValidationError {
    return new SatimValidationError(
      `The SATIM order number [${orderNumber}] is invalid: it must be exactly 10 alphanumeric characters.`,
    );
  }

  static orderNumberUnavailable(attempts: number): SatimValidationError {
    return new SatimValidationError(
      `No unused SATIM order number was found in ${attempts} attempts, which should not happen: ` +
        'check the audit trail for a flood of registrations.',
    );
  }

  static nonNumericAmount(amount: string): SatimValidationError {
    return new SatimValidationError(`The SATIM amount [${amount}] is invalid: it must be numeric.`);
  }

  static amountBelowMinimum(centimes: number, minimum: number): SatimValidationError {
    return new SatimValidationError(
      `The SATIM amount of ${centimes} centimes is below the gateway minimum of ${minimum} centimes.`,
    );
  }

  static receiptForUnpaidTransaction(orderId: string): SatimValidationError {
    return new SatimValidationError(
      `A receipt cannot be built for order [${orderId}] because the payment was not accepted.`,
    );
  }

  static missingOrderId(): SatimValidationError {
    return new SatimValidationError('The SATIM order id is required and cannot be empty.');
  }

  static udfTooLong(field: string, length: number): SatimValidationError {
    return new SatimValidationError(
      `The SATIM parameter [${field}] is ${length} characters long; the maximum is 20.`,
    );
  }

  static language(language: string): SatimValidationError {
    return new SatimValidationError(
      `The SATIM language [${language}] is invalid: supported languages are AR, FR and EN.`,
    );
  }
}

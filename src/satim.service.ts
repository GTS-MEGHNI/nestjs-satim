import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { SatimAuditService } from './audit.service.js';
import { SatimConfigurationError, SatimValidationError } from './errors.js';
import {
  SatimCallCompletedEvent,
  SatimCallFailedEvent,
  SatimCallStartedEvent,
  SatimEventName,
  type SatimEventPublisher,
} from './events.js';
import { isSatimLanguage, type SatimLanguage } from './language.js';
import { messagesFor } from './messages.js';
import { endpointFor, SatimOperation } from './operation.js';
import { DZD_CURRENCY, type ResolvedSatimOptions } from './options.js';
import { randomOrderNumber } from './order-number.js';
import type { SatimResponse } from './response-reader.js';
import { AcknowledgeResult } from './results/acknowledge-result.js';
import { Receipt } from './results/receipt.js';
import { RefundResult } from './results/refund-result.js';
import { RegisterResult } from './results/register-result.js';
import { SATIM_EVENT_PUBLISHER, SATIM_OPTIONS, SATIM_TRANSPORT } from './tokens.js';
import type { SatimTransport } from './transport.js';

/** SATIM refuses payments below 50 DA. */
export const MINIMUM_AMOUNT_IN_CENTIMES = 5000;

/** Longest value SATIM accepts for each udf slot. */
const UDF_MAX_LENGTH = 20;

export interface RegisterArguments {
  /** Exactly 10 alphanumeric characters, unique per attempt. */
  orderNumber: string;

  /** Amount in DZD; converted to centimes for the gateway. */
  amount: number | string;

  description?: string;

  /** Defaults to the configured language. */
  language?: SatimLanguage | string;

  /** Merchant reference echoed back on acknowledge; defaults to the order number. */
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;

  /** Transaction type indicator, "CP" or "698". */
  fundingTypeIndicator?: string;
}

/**
 * The SATIM gateway.
 *
 * Every call announces itself before the request leaves and again when the
 * answer arrives, so a call that dies in flight is still on record. A
 * gateway-side rejection is reported through the returned result, never by
 * throwing: only a local rule being broken, or the gateway being unreachable,
 * throws.
 */
@Injectable()
export class SatimService {
  constructor(
    @Inject(SATIM_OPTIONS) private readonly options: ResolvedSatimOptions,
    @Inject(SATIM_TRANSPORT) private readonly transport: SatimTransport,
    @Inject(SATIM_EVENT_PUBLISHER) private readonly events: SatimEventPublisher,
    private readonly audit: SatimAuditService,
  ) {}

  /**
   * A fresh order number in the format SATIM requires.
   *
   * Ten random alphanumeric characters, checked against the audit trail so a
   * number this application already sent is never sent twice. That check is not
   * a guarantee: only a unique index on your own order table, and SATIM's own
   * rejection of a repeated number, can give you one.
   *
   * @param attempts How many numbers to try before giving up.
   * @throws SatimValidationError When no unused number turned up, which means something is very wrong.
   */
  async orderNumber(attempts = 5): Promise<string> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const candidate = randomOrderNumber();

      if (!(await this.audit.hasOrderNumber(candidate))) {
        return candidate;
      }
    }

    throw SatimValidationError.orderNumberUnavailable(attempts);
  }

  /**
   * Register an order and obtain the hosted payment page URL.
   *
   * Persist the payment attempt BEFORE calling this, then store the result's
   * rawRequest and rawResponse against it.
   *
   * The return and fail URLs come from the module options, which SATIM requires
   * on every order and which resolving the module already validated.
   *
   * @throws SatimValidationError
   * @throws SatimConnectionError
   */
  async register(args: RegisterArguments): Promise<RegisterResult> {
    if (!/^[A-Za-z0-9]{10}$/u.test(args.orderNumber)) {
      throw SatimValidationError.orderNumber(args.orderNumber);
    }

    const amountInCentimes = this.toCentimes(args.amount);

    const payload = this.compact({
      userName: this.options.username,
      password: this.options.password,
      orderNumber: args.orderNumber,
      amount: String(amountInCentimes),
      currency: this.options.currency,
      returnUrl: this.options.returnUrl,
      failUrl: this.options.failUrl,
      description: args.description,
      language: this.resolveLanguage(args.language),
      jsonParams: this.jsonParams(
        {
          udf1: args.udf1 ?? args.orderNumber,
          udf2: args.udf2,
          udf3: args.udf3,
          udf4: args.udf4,
          udf5: args.udf5,
        },
        args.fundingTypeIndicator,
      ),
    });

    const callId = randomUUID();

    const response = await this.send(
      new SatimCallStartedEvent(
        callId,
        SatimOperation.Register,
        endpointFor(SatimOperation.Register),
        this.redact(payload),
        args.orderNumber,
        null,
        amountInCentimes,
      ),
      payload,
    );

    const result = RegisterResult.fromResponse(response, this.redact(payload));

    await this.completed(
      new SatimCallCompletedEvent(
        callId,
        SatimOperation.Register,
        response,
        result.successful(),
        result.orderId,
        result.errorCode,
        result.errorMessage,
      ),
    );

    return result;
  }

  /**
   * Confirm the final outcome of a payment after the customer comes back.
   *
   * SATIM cancels unconfirmed orders after a delay, so call this on both the
   * return and the fail URL rather than trusting the redirect alone.
   *
   * @param orderId The orderId register returned, sent as mdOrder.
   * @param language Language of the returned wording; defaults to the configured one.
   * @throws SatimValidationError
   * @throws SatimConnectionError
   */
  async acknowledge(
    orderId: string,
    language?: SatimLanguage | string,
  ): Promise<AcknowledgeResult> {
    if (orderId.trim() === '') {
      throw SatimValidationError.missingOrderId();
    }

    const resolvedLanguage = this.resolveLanguage(language);

    const payload = {
      userName: this.options.username,
      password: this.options.password,
      mdOrder: orderId,
      language: resolvedLanguage,
    };

    const callId = randomUUID();

    const response = await this.send(
      new SatimCallStartedEvent(
        callId,
        SatimOperation.Acknowledge,
        endpointFor(SatimOperation.Acknowledge),
        this.redact(payload),
        null,
        orderId,
      ),
      payload,
    );

    const result = AcknowledgeResult.fromResponse(
      orderId,
      response,
      this.redact(payload),
      messagesFor(resolvedLanguage).transactionRejected,
    );

    await this.completed(
      new SatimCallCompletedEvent(
        callId,
        SatimOperation.Acknowledge,
        response,
        result.paid(),
        orderId,
        result.errorCode,
        result.errorMessage,
        result.orderStatus,
      ),
    );

    return result;
  }

  /**
   * Return money already deposited for an order.
   *
   * SATIM allows several refunds against one order as long as they do not add
   * up to more than was deposited, and refuses a refund on an order that was
   * never charged. Your SATIM user needs the refund permission.
   *
   * @param orderId The orderId register returned, also called mdOrder.
   * @param amount Amount in DZD to return; converted to centimes.
   * @throws SatimValidationError
   * @throws SatimConnectionError
   */
  async refund(
    orderId: string,
    amount: number | string,
    language?: SatimLanguage | string,
  ): Promise<RefundResult> {
    if (orderId.trim() === '') {
      throw SatimValidationError.missingOrderId();
    }

    const amountInCentimes = this.toCentimes(amount);

    // SATIM's own parameter table requires only these four, and its example
    // sends nothing else. Language is added for a localised message; the refund
    // uses the currency the order was placed in.
    const payload = {
      userName: this.options.username,
      password: this.options.password,
      orderId,
      amount: String(amountInCentimes),
      language: this.resolveLanguage(language),
    };

    const callId = randomUUID();

    const response = await this.send(
      new SatimCallStartedEvent(
        callId,
        SatimOperation.Refund,
        endpointFor(SatimOperation.Refund),
        this.redact(payload),
        null,
        orderId,
        amountInCentimes,
      ),
      payload,
    );

    const result = RefundResult.fromResponse(
      orderId,
      amountInCentimes,
      response,
      this.redact(payload),
    );

    await this.completed(
      new SatimCallCompletedEvent(
        callId,
        SatimOperation.Refund,
        response,
        result.successful(),
        orderId,
        result.errorCode,
        result.errorMessage,
      ),
    );

    return result;
  }

  /**
   * Build the contents of a payment receipt.
   *
   * Build it once after confirming the payment and store it, then pass the
   * stored date back on later requests: your spec requires a reprint to be the
   * original receipt, not a freshly dated one.
   *
   * @param paidAt Defaults to now, which is the moment you confirmed.
   * @param language Defaults to the language of the confirmation.
   * @throws SatimValidationError
   * @throws SatimConfigurationError
   */
  receipt(result: AcknowledgeResult, paidAt?: Date, language?: SatimLanguage | string): Receipt {
    if (result.rejected()) {
      throw SatimValidationError.receiptForUnpaidTransaction(result.orderId);
    }

    if (this.options.receiptLogo === undefined || this.options.receiptLogo.trim() === '') {
      throw SatimConfigurationError.missing('receiptLogo');
    }

    const resolvedLanguage = this.resolveLanguage(language);

    return new Receipt(
      result.orderId,
      result.orderNumber,
      result.approvalCode,
      paidAt ?? new Date(),
      result.amount,
      result.amountInCentimes,
      result.currency,
      this.currencyLabel(result.currency),
      result.maskedCard,
      result.cardholderName,
      result.message,
      resolvedLanguage,
      messagesFor(resolvedLanguage).supportMessage,
      this.options.receiptLogo,
    );
  }

  /**
   * Hotline text, which the spec requires beside the SATIM logo and never on
   * its own.
   *
   * SATIM requires it on a rejected return page too, where there is no receipt
   * to carry it, so it is available on its own.
   *
   * @param language Defaults to the configured language.
   * @throws SatimValidationError
   */
  supportMessage(language?: SatimLanguage | string): string {
    return messagesFor(this.resolveLanguage(language)).supportMessage;
  }

  /**
   * SATIM answers with an ISO currency number, which means nothing on a
   * receipt. Only DZD is in use, so anything else is shown as sent.
   */
  private currencyLabel(currency: string | null): string {
    return currency === DZD_CURRENCY ? 'DZD' : String(currency);
  }

  /**
   * Announce the call, record it, send it, and announce a failure that never
   * came back.
   *
   * The announcement goes out before the request leaves, so a call that dies in
   * flight is still on record.
   *
   * @throws SatimConnectionError
   */
  private async send(
    started: SatimCallStartedEvent,
    payload: Record<string, string>,
  ): Promise<SatimResponse> {
    await this.audit.started(started, new Date());
    await this.events.publish(SatimEventName.CallStarted, started);

    try {
      return await this.transport.post(started.operation, payload);
    } catch (error) {
      const failed = new SatimCallFailedEvent(
        started.callId,
        started.operation,
        error instanceof Error ? error.message : String(error),
      );

      await this.audit.failed(failed);
      await this.events.publish(SatimEventName.CallFailed, failed);

      throw error;
    }
  }

  private async completed(event: SatimCallCompletedEvent): Promise<void> {
    await this.audit.completed(event, new Date());
    await this.events.publish(SatimEventName.CallCompleted, event);
  }

  /**
   * @throws SatimValidationError
   */
  private jsonParams(
    udf: Record<string, string | undefined>,
    fundingTypeIndicator: string | undefined,
  ): string {
    const params: Record<string, string> = { force_terminal_id: this.options.terminalId };

    for (const [field, value] of Object.entries(udf)) {
      if (value === undefined || value === '') {
        continue;
      }

      if ([...value].length > UDF_MAX_LENGTH) {
        throw SatimValidationError.udfTooLong(field, [...value].length);
      }

      params[field] = value;
    }

    if (fundingTypeIndicator !== undefined && fundingTypeIndicator !== '') {
      params['fundingTypeIndicator'] = fundingTypeIndicator;
    }

    return JSON.stringify(params);
  }

  /**
   * SATIM expects centimes; business amounts stay decimal on the caller side.
   *
   * @throws SatimValidationError
   */
  private toCentimes(amount: number | string): number {
    let value = amount;

    if (typeof value === 'string') {
      if (value.trim() === '' || !Number.isFinite(Number(value.trim()))) {
        throw SatimValidationError.nonNumericAmount(value);
      }

      value = Number(value.trim());
    }

    if (!Number.isFinite(value)) {
      throw SatimValidationError.nonNumericAmount(String(amount));
    }

    const centimes = Math.round(value * 100);

    if (centimes < MINIMUM_AMOUNT_IN_CENTIMES) {
      throw SatimValidationError.amountBelowMinimum(centimes, MINIMUM_AMOUNT_IN_CENTIMES);
    }

    return centimes;
  }

  /**
   * @throws SatimValidationError
   */
  private resolveLanguage(language: SatimLanguage | string | undefined): SatimLanguage {
    if (language === undefined) {
      return this.options.language;
    }

    const upper = language.toUpperCase();

    if (!isSatimLanguage(upper)) {
      throw SatimValidationError.language(language);
    }

    return upper;
  }

  /** Drop the keys SATIM must not receive as empty values. */
  private compact(payload: Record<string, string | undefined>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(payload).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
      ),
    );
  }

  /** Keep credentials out of the payload callers are expected to persist. */
  private redact(payload: Record<string, string>): Record<string, string> {
    return { ...payload, userName: '[REDACTED]', password: '[REDACTED]' };
  }
}

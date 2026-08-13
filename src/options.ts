import type {
  SatimCallCompletedEvent,
  SatimCallFailedEvent,
  SatimCallStartedEvent,
  SatimOrderReconciledEvent,
} from './events.js';
import type { SatimLanguage } from './language.js';

/**
 * How long SATIM keeps evidence worth keeping: ten years, the period article 12
 * of the Algerian code de commerce sets for commercial books and documents.
 */
export const DEFAULT_RETENTION_DAYS = 365 * 10;

/**
 * SATIM gives the customer 20 minutes on the payment page, so 30 leaves a
 * margin: below 20 the reconciler would be asking about orders a customer is
 * still in the middle of paying.
 */
export const DEFAULT_RECONCILE_AFTER_MINUTES = 30;

/**
 * Stops the reconciler asking about orders old enough that no answer will ever
 * change, so an order SATIM never resolves is not polled forever.
 */
export const DEFAULT_RECONCILE_WITHIN_MINUTES = 60 * 24 * 7;

export const DEFAULT_RECONCILE_LIMIT = 100;

/**
 * Keep this generous: cutting a request off does not undo it, so a short value
 * risks money moving without the application ever learning the outcome.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** ISO 4217 numeric code for the Algerian dinar. */
export const DZD_CURRENCY = '012';

export interface SatimAuditOptions {
  /**
   * On by default, because SATIM may ask months later what exactly was
   * exchanged for a payment, and the evidence has to exist by then. Switched
   * off, the gateway calls run without touching the store at all, and
   * orderNumber() has nothing to check a candidate against.
   */
  enabled?: boolean;

  /**
   * Days a record is kept, applied by SatimAuditService.prune(). Null keeps
   * everything. Do not shorten it without asking whoever answers for your
   * accounting: this is the evidence of what was exchanged for a payment, and a
   * dispute long outlives a checkout.
   */
  retentionDays?: number | null;
}

export interface SatimReconcileOptions {
  /** Minutes an order must have gone unconfirmed before it is asked about. */
  afterMinutes?: number;

  /** Ignore orders registered longer ago than this many minutes. */
  withinMinutes?: number;

  /** Most orders to confirm in one run. */
  limit?: number;

  /**
   * Milliseconds between automatic runs. Left unset, nothing runs on its own
   * and SatimReconcileService.run() is called by your own scheduler.
   */
  everyMs?: number;
}

/**
 * Called as the package works, in addition to whatever the event publisher
 * does. Present so an application can listen without installing an event
 * library; a throwing hook is swallowed and never breaks a payment.
 */
export interface SatimEventHooks {
  onCallStarted?: (event: SatimCallStartedEvent) => void | Promise<void>;
  onCallCompleted?: (event: SatimCallCompletedEvent) => void | Promise<void>;
  onCallFailed?: (event: SatimCallFailedEvent) => void | Promise<void>;
  onOrderReconciled?: (event: SatimOrderReconciledEvent) => void | Promise<void>;
}

/**
 * Everything the module needs to reach the gateway.
 *
 * Deliberately a plain object with no validation library behind it: a missing
 * key has to fail with the name of the key an operator must go and set, which a
 * generic schema error does not give them.
 */
export interface SatimModuleOptions {
  /**
   * Root of the SATIM REST API, no trailing slash and no endpoint segment.
   *
   * There is deliberately no default: the production host is NOT the test host,
   * so a fallback value would risk sending live money to the wrong gateway. The
   * value must use HTTPS.
   *
   * Test: https://test2.satim.dz/payment/rest
   */
  baseUrl: string;

  /** Issued by SATIM during registration. */
  username: string;

  password: string;

  /** Sent to the gateway as `force_terminal_id` inside the jsonParams payload. */
  terminalId: string;

  /**
   * Where SATIM sends the customer back to. Both are required by the gateway,
   * and both must be absolute URLs it can reach.
   *
   * They are configured here and only here: register() sends these values and
   * takes no URL arguments, so the gateway can only ever redirect a customer to
   * an address this environment declared. Carry your own reference through the
   * order number instead of through the URL.
   *
   * Confirm the outcome on BOTH: a customer landing on the fail URL is not
   * proof of failure, only acknowledge() decides.
   */
  returnUrl: string;

  failUrl: string;

  /** ISO 4217 numeric code. Defaults to "012", the Algerian dinar. */
  currency?: string;

  /** Language of the hosted payment page. Defaults to FR. */
  language?: SatimLanguage;

  /** How long to wait for the whole exchange. Defaults to 30 seconds. */
  timeoutMs?: number;

  /**
   * Passed straight to `fetch` as its dispatcher. An undici `Agent` here is how
   * to get a separate connect timeout, which native fetch alone cannot express.
   */
  dispatcher?: unknown;

  /**
   * Path of the SATIM logo shown beside the hotline message. SATIM requires the
   * logo to appear beside the hotline message and never on its own, so leaving
   * this unset makes building a receipt fail rather than producing the message
   * alone.
   */
  receiptLogo?: string;

  audit?: SatimAuditOptions;

  reconcile?: SatimReconcileOptions;

  hooks?: SatimEventHooks;
}

/** The options as the rest of the package reads them, with defaults applied. */
export interface ResolvedSatimOptions extends SatimModuleOptions {
  currency: string;
  language: SatimLanguage;
  timeoutMs: number;
  audit: Required<SatimAuditOptions>;
  reconcile: Required<Omit<SatimReconcileOptions, 'everyMs'>> & { everyMs?: number };
}

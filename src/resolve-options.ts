import { SatimConfigurationError } from './errors.js';
import { isSatimLanguage, SatimLanguage } from './language.js';
import {
  DEFAULT_RECONCILE_AFTER_MINUTES,
  DEFAULT_RECONCILE_LIMIT,
  DEFAULT_RECONCILE_WITHIN_MINUTES,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_TIMEOUT_MS,
  DZD_CURRENCY,
  type ResolvedSatimOptions,
  type SatimModuleOptions,
} from './options.js';

/** Longest terminal id SATIM accepts for force_terminal_id. */
const TERMINAL_ID_MAX_LENGTH = 16;

const REQUIRED = ['baseUrl', 'username', 'password', 'terminalId', 'returnUrl', 'failUrl'] as const;

function requiredString(options: SatimModuleOptions, key: (typeof REQUIRED)[number]): string {
  const value = options[key];

  if (typeof value !== 'string' || value.trim() === '') {
    throw SatimConfigurationError.missing(key);
  }

  return value.trim();
}

/**
 * A redirect URL SATIM sends the customer back to.
 *
 * Required rather than optional: SATIM marks both URLs mandatory on every
 * order, and they belong to the environment, not to a single payment.
 */
function redirectUrl(options: SatimModuleOptions, key: 'returnUrl' | 'failUrl'): string {
  const url = requiredString(options, key);

  if (!URL.canParse(url)) {
    throw SatimConfigurationError.invalid(key, 'it must be an absolute URL SATIM can redirect to.');
  }

  return url;
}

function baseUrl(options: SatimModuleOptions): string {
  const value = requiredString(options, 'baseUrl').replace(/\/+$/u, '');

  if (!URL.canParse(value)) {
    throw SatimConfigurationError.invalid('baseUrl', 'it must be an absolute URL.');
  }

  if (new URL(value).protocol !== 'https:') {
    throw SatimConfigurationError.invalid('baseUrl', 'it must use HTTPS.');
  }

  return value;
}

function terminalId(options: SatimModuleOptions): string {
  const value = requiredString(options, 'terminalId');

  if (value.length > TERMINAL_ID_MAX_LENGTH) {
    throw SatimConfigurationError.invalid(
      'terminalId',
      `it must not exceed ${TERMINAL_ID_MAX_LENGTH} characters.`,
    );
  }

  return value;
}

function currency(options: SatimModuleOptions): string {
  const value = options.currency ?? DZD_CURRENCY;

  if (!/^\d{3}$/u.test(value)) {
    throw SatimConfigurationError.invalid(
      'currency',
      'it must be a 3 digit ISO 4217 numeric code, such as "012" for DZD.',
    );
  }

  return value;
}

function language(options: SatimModuleOptions): SatimLanguage {
  const value = options.language ?? SatimLanguage.FR;

  if (!isSatimLanguage(value)) {
    throw SatimConfigurationError.invalid('language', 'supported languages are AR, FR and EN.');
  }

  return value;
}

function positiveNumber(value: number | undefined, key: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 1) {
    throw SatimConfigurationError.invalid(key, 'it must be a positive number.');
  }

  return value;
}

/**
 * Validated snapshot of the module options.
 *
 * Checked when the options are resolved rather than when they are used, so an
 * application with a missing key learns which key at boot instead of letting
 * SATIM reject a half-empty request at checkout.
 */
export function resolveSatimOptions(options: SatimModuleOptions): ResolvedSatimOptions {
  const audit = options.audit ?? {};
  const reconcile = options.reconcile ?? {};
  const retentionDays =
    audit.retentionDays === undefined ? DEFAULT_RETENTION_DAYS : audit.retentionDays;

  return {
    ...options,
    baseUrl: baseUrl(options),
    username: requiredString(options, 'username'),
    password: requiredString(options, 'password'),
    terminalId: terminalId(options),
    returnUrl: redirectUrl(options, 'returnUrl'),
    failUrl: redirectUrl(options, 'failUrl'),
    currency: currency(options),
    language: language(options),
    timeoutMs: positiveNumber(options.timeoutMs, 'timeoutMs', DEFAULT_TIMEOUT_MS),
    audit: {
      enabled: audit.enabled ?? true,
      retentionDays:
        retentionDays === null
          ? null
          : positiveNumber(retentionDays, 'audit.retentionDays', DEFAULT_RETENTION_DAYS),
    },
    reconcile: {
      afterMinutes: positiveNumber(
        reconcile.afterMinutes,
        'reconcile.afterMinutes',
        DEFAULT_RECONCILE_AFTER_MINUTES,
      ),
      withinMinutes: positiveNumber(
        reconcile.withinMinutes,
        'reconcile.withinMinutes',
        DEFAULT_RECONCILE_WITHIN_MINUTES,
      ),
      limit: positiveNumber(reconcile.limit, 'reconcile.limit', DEFAULT_RECONCILE_LIMIT),
      ...(reconcile.everyMs === undefined
        ? {}
        : { everyMs: positiveNumber(reconcile.everyMs, 'reconcile.everyMs', 0) }),
    },
  };
}

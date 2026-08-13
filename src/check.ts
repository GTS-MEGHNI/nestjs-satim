import { SatimConfigurationError } from './errors.js';
import type { SatimModuleOptions } from './options.js';
import { resolveSatimOptions } from './resolve-options.js';

export interface SatimCheckResult {
  valid: boolean;

  /** Why the options were refused, when they were. */
  error: string | null;

  /** Setting and value pairs, safe to print: the password is masked. */
  settings: [setting: string, value: string][];
}

/**
 * Validate the options and describe what they resolved to.
 *
 * Run this on deploy: it turns a missing environment variable into a failed
 * release instead of a failed payment at checkout.
 */
export function checkSatimOptions(options: SatimModuleOptions): SatimCheckResult {
  let resolved;

  try {
    resolved = resolveSatimOptions(options);
  } catch (error) {
    if (!(error instanceof SatimConfigurationError)) {
      throw error;
    }

    return { valid: false, error: error.message, settings: [] };
  }

  return {
    valid: true,
    error: null,
    settings: [
      ['baseUrl', resolved.baseUrl],
      ['username', resolved.username],
      ['password', '*'.repeat(8)],
      ['terminalId', resolved.terminalId],
      ['returnUrl', resolved.returnUrl],
      ['failUrl', resolved.failUrl],
      ['currency', resolved.currency],
      ['language', resolved.language],
      ['timeoutMs', `${resolved.timeoutMs}ms`],
      ['audit.enabled', String(resolved.audit.enabled)],
      [
        'audit.retentionDays',
        resolved.audit.retentionDays === null ? 'forever' : String(resolved.audit.retentionDays),
      ],
      ['receiptLogo', resolved.receiptLogo ?? 'not set (receipts unavailable)'],
    ],
  };
}

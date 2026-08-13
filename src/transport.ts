import type { SatimOperation } from './operation.js';

/**
 * What carries a gateway call to SATIM and brings the answer back.
 *
 * The one seam the package swaps out under test: everything above it, from
 * validation to the audit trail, still runs against a fake transport, so a test
 * that passes has exercised the same code a real payment would.
 */
export interface SatimTransport {
  /**
   * @param payload Credentials included, as SATIM expects them.
   * @returns The decoded response.
   * @throws SatimConnectionException When the gateway could not be reached or answered unusably.
   */
  post(
    operation: SatimOperation,
    payload: Record<string, string>,
  ): Promise<Record<string, unknown>>;
}

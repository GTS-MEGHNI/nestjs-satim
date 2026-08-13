import { Inject, Injectable } from '@nestjs/common';

import { SatimConnectionError } from './errors.js';
import { endpointFor, type SatimOperation } from './operation.js';
import type { SatimModuleOptions } from './options.js';
import { SATIM_OPTIONS } from './tokens.js';
import type { SatimTransport } from './transport.js';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Transport for the SATIM REST API, on Node's own fetch.
 *
 * SATIM expects form encoded POST bodies and answers with JSON, even for the
 * endpoints its documentation illustrates with query strings.
 */
@Injectable()
export class FetchSatimTransport implements SatimTransport {
  constructor(@Inject(SATIM_OPTIONS) private readonly options: SatimModuleOptions) {}

  async post(
    operation: SatimOperation,
    payload: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.options.baseUrl}/${endpointFor(operation)}`;

    // `dispatcher` is a Node extension to RequestInit, and its type comes from
    // whichever undici the consumer's @types/node carries. Typing the option as
    // unknown keeps this package off those internals, at the price of one cast.
    const init: Omit<RequestInit, 'dispatcher'> & { dispatcher?: unknown } = {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(payload),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      ...(this.options.dispatcher === undefined ? {} : { dispatcher: this.options.dispatcher }),
    };

    let response: Response;

    try {
      response = await fetch(url, init as unknown as RequestInit);
    } catch (cause) {
      throw SatimConnectionError.requestFailed(url, cause);
    }

    if (!response.ok) {
      throw SatimConnectionError.unexpectedStatus(url, response.status);
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      throw SatimConnectionError.invalidResponse(url);
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw SatimConnectionError.invalidResponse(url);
    }

    return data as Record<string, unknown>;
  }
}

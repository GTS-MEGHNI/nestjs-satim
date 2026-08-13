/**
 * SATIM is inconsistent about response value types: the same field can arrive
 * as a string on one endpoint and as a number on another, and optional fields
 * are sometimes present but empty.
 */
export type SatimResponse = Record<string, unknown>;

export function stringValue(response: SatimResponse, key: string): string | null {
  let value = response[key] ?? null;

  if (typeof value === 'number') {
    value = String(value);
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  return value;
}

export function intValue(response: SatimResponse, key: string): number | null {
  const value = response[key] ?? null;

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
    return Math.trunc(Number(value.trim()));
  }

  return null;
}

/**
 * The nested "params" object, which carries respCode and respCode_desc.
 */
export function paramsOf(response: SatimResponse): SatimResponse {
  const params = response['params'] ?? null;

  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return {};
  }

  return params as SatimResponse;
}

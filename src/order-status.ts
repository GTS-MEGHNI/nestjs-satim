/**
 * Order states SATIM reports, as listed in the integration guide.
 *
 * These are the values SATIM's merchant portal documents. A status outside this
 * list leaves the named status null and keeps the raw number instead.
 *
 * A cancellation performed by staff inside SATIM's back office shows up as
 * Reversed, and a refund as Refunded, whether the refund came from the back
 * office or from refund.do.
 */
export const SatimOrderStatus = {
  /** Generic decline fallback. */
  Declined: -1,

  /** Registered, but not paid. */
  Registered: 0,

  /** Approved in one-phase, or held as a preauthorisation in two-phase. */
  Approved: 1,

  /** Amount deposited: the only status that means the customer paid. */
  Deposited: 2,

  /** Authorisation reversed, which is how a cancellation shows up. */
  Reversed: 3,

  /** Transaction refunded. */
  Refunded: 4,

  /** Authorisation declined. */
  AuthorisationDeclined: 6,
} as const;

export type SatimOrderStatus = (typeof SatimOrderStatus)[keyof typeof SatimOrderStatus];

const KNOWN = new Set<number>(Object.values(SatimOrderStatus));

export function toSatimOrderStatus(value: number | null): SatimOrderStatus | null {
  return value !== null && KNOWN.has(value) ? (value as SatimOrderStatus) : null;
}

/** The name SATIM's documentation gives this status, for display in a log. */
export function orderStatusName(status: SatimOrderStatus): string {
  const entry = Object.entries(SatimOrderStatus).find(([, value]) => value === status);

  return entry === undefined ? String(status) : entry[0];
}

/** The money reached the merchant. */
export function isPaidStatus(status: SatimOrderStatus | null): boolean {
  return status === SatimOrderStatus.Deposited;
}

/** Refunded, whether from refund.do or from SATIM's back office. */
export function isRefundedStatus(status: SatimOrderStatus | null): boolean {
  return status === SatimOrderStatus.Refunded;
}

/** Cancelled from SATIM's back office: the authorisation was reversed. */
export function isCancelledStatus(status: SatimOrderStatus | null): boolean {
  return status === SatimOrderStatus.Reversed;
}

/** The money was taken back, whether by refund or by cancellation. */
export function isReturnedStatus(status: SatimOrderStatus | null): boolean {
  return isRefundedStatus(status) || isCancelledStatus(status);
}

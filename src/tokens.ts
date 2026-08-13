/**
 * Injection tokens for everything the module lets an application replace.
 *
 * Interfaces do not survive compilation, so a token is the only way to inject
 * one. Every replaceable seam is named here rather than at its use site, so a
 * consumer overriding one has a single list to read.
 */
export const SATIM_OPTIONS = Symbol('SATIM_OPTIONS');

/** Carries a call to the gateway and brings the answer back. */
export const SATIM_TRANSPORT = Symbol('SATIM_TRANSPORT');

/** Persists the audit trail. Swapped per ORM; the core never touches one. */
export const SATIM_CALL_STORE = Symbol('SATIM_CALL_STORE');

/** Announces what the package did. Defaults to the module option hooks. */
export const SATIM_EVENT_PUBLISHER = Symbol('SATIM_EVENT_PUBLISHER');

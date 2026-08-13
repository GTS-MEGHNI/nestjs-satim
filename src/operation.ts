/**
 * The three gateway calls this package makes, and the endpoint each one hits.
 *
 * A const object rather than a TypeScript enum: the value is what goes on the
 * wire and in the audit trail, and a union of string literals keeps that value
 * visible in every type error instead of hiding it behind an enum member.
 */
export const SatimOperation = {
  Register: 'register',
  Acknowledge: 'acknowledge',
  Refund: 'refund',
} as const;

export type SatimOperation = (typeof SatimOperation)[keyof typeof SatimOperation];

const ENDPOINTS: Record<SatimOperation, string> = {
  [SatimOperation.Register]: 'register.do',
  [SatimOperation.Acknowledge]: 'public/acknowledgeTransaction.do',
  [SatimOperation.Refund]: 'refund.do',
};

export function endpointFor(operation: SatimOperation): string {
  return ENDPOINTS[operation];
}

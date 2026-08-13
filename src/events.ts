import type { SatimOperation } from './operation.js';
import type { SatimResponse } from './response-reader.js';
import type { AcknowledgeResult } from './results/acknowledge-result.js';

/**
 * Event names, for a listener that subscribes by string (`@OnEvent`).
 *
 * Namespaced under "satim." so an application can subscribe to all of them with
 * a wildcard.
 */
export const SatimEventName = {
  CallStarted: 'satim.call.started',
  CallCompleted: 'satim.call.completed',
  CallFailed: 'satim.call.failed',
  OrderReconciled: 'satim.order.reconciled',
} as const;

export type SatimEventName = (typeof SatimEventName)[keyof typeof SatimEventName];

/**
 * A gateway call is about to be sent.
 *
 * Emitted before the request leaves, so a call that never comes back still
 * leaves a trace. Listen to this and the two events below to keep your own
 * audit trail instead of, or alongside, the one this package records for you.
 */
export class SatimCallStartedEvent {
  constructor(
    /** Correlates this event with its completion or failure. */
    readonly callId: string,
    readonly operation: SatimOperation,
    readonly endpoint: string,
    /** What was sent, with credentials redacted. */
    readonly payload: Record<string, string>,
    readonly orderNumber: string | null = null,
    readonly orderId: string | null = null,
    readonly amountInCentimes: number | null = null,
  ) {}
}

/**
 * The gateway answered.
 *
 * "Successful" is the meaningful outcome of each call rather than merely a
 * reply arriving: an order id for register, a paid transaction for acknowledge,
 * and a zero error code for refund. A confirmed but rejected payment is
 * therefore completed and not successful.
 */
export class SatimCallCompletedEvent {
  constructor(
    readonly callId: string,
    readonly operation: SatimOperation,
    /** The decoded reply, verbatim. */
    readonly response: SatimResponse,
    readonly successful: boolean,
    readonly orderId: string | null = null,
    readonly errorCode: string | null = null,
    readonly errorMessage: string | null = null,
    readonly orderStatus: number | null = null,
  ) {}
}

/**
 * The gateway could not be reached, or answered unusably.
 *
 * This is the case an audit trail most needs and most easily loses: money may
 * have moved even though your application never saw a reply.
 */
export class SatimCallFailedEvent {
  constructor(
    readonly callId: string,
    readonly operation: SatimOperation,
    readonly reason: string,
  ) {}
}

/**
 * An order the customer never came back from was resolved with the gateway.
 *
 * The package knows SATIM's answer but nothing about your order, so this is
 * where you take over: mark the order paid, failed, or abandoned from the
 * result. Emitted once per order by the reconciler.
 */
export class SatimOrderReconciledEvent {
  constructor(
    readonly orderId: string,
    readonly result: AcknowledgeResult,
  ) {}
}

export type SatimEvent =
  | SatimCallStartedEvent
  | SatimCallCompletedEvent
  | SatimCallFailedEvent
  | SatimOrderReconciledEvent;

/**
 * Where the package announces what it did.
 *
 * The default implementation calls the hooks passed in the module options, and
 * nothing else, so the core needs no event library. Bind
 * SatimEventEmitterPublisher from the "/event-emitter" entry point to bridge
 * these onto @nestjs/event-emitter instead.
 */
export interface SatimEventPublisher {
  publish(name: SatimEventName, event: SatimEvent): void | Promise<void>;
}

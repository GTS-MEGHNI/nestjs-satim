import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { SatimEvent, SatimEventName, SatimEventPublisher } from '../events.js';

/**
 * Publishes the package's events onto @nestjs/event-emitter, so an application
 * can subscribe with `@OnEvent('satim.call.completed')` or `@OnEvent('satim.*')`.
 *
 * Only this entry point imports @nestjs/event-emitter: importing it is what
 * declares that the application installed it.
 *
 * Bind it as an extra provider:
 *
 * ```ts
 * SatimModule.register(options, {
 *   extraProviders: [{ provide: SATIM_EVENT_PUBLISHER, useClass: SatimEventEmitterPublisher }],
 * })
 * ```
 */
@Injectable()
export class SatimEventEmitterPublisher implements SatimEventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  publish(name: SatimEventName, event: SatimEvent): void {
    this.emitter.emit(name, event);
  }
}

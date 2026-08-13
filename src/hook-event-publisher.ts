import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  type SatimEvent,
  SatimEventName,
  type SatimEventPublisher,
  SatimCallCompletedEvent,
  SatimCallFailedEvent,
  SatimCallStartedEvent,
  SatimOrderReconciledEvent,
} from './events.js';
import type { ResolvedSatimOptions } from './options.js';
import { SATIM_OPTIONS } from './tokens.js';

/**
 * The publisher the module binds when the application binds nothing else.
 *
 * It calls the hooks from the module options and nothing more, which is what
 * keeps the core free of an event library. A hook that throws is logged and
 * swallowed: an application's own bookkeeping must not be able to fail a
 * payment that the gateway already accepted.
 */
@Injectable()
export class HookSatimEventPublisher implements SatimEventPublisher {
  private readonly logger = new Logger(HookSatimEventPublisher.name);

  constructor(@Inject(SATIM_OPTIONS) private readonly options: ResolvedSatimOptions) {}

  async publish(name: SatimEventName, event: SatimEvent): Promise<void> {
    const hooks = this.options.hooks ?? {};

    try {
      if (name === SatimEventName.CallStarted) {
        await hooks.onCallStarted?.(event as SatimCallStartedEvent);
      } else if (name === SatimEventName.CallCompleted) {
        await hooks.onCallCompleted?.(event as SatimCallCompletedEvent);
      } else if (name === SatimEventName.CallFailed) {
        await hooks.onCallFailed?.(event as SatimCallFailedEvent);
      } else {
        await hooks.onOrderReconciled?.(event as SatimOrderReconciledEvent);
      }
    } catch (error) {
      this.logger.error(
        `A SATIM [${name}] hook threw and was ignored: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

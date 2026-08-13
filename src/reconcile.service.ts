import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { SatimAuditService } from './audit.service.js';
import { SatimConnectionError, SatimValidationError } from './errors.js';
import { SatimEventName, type SatimEventPublisher, SatimOrderReconciledEvent } from './events.js';
import type { ResolvedSatimOptions } from './options.js';
import { orderStatusName } from './order-status.js';
import { SatimService } from './satim.service.js';
import { SATIM_EVENT_PUBLISHER, SATIM_OPTIONS } from './tokens.js';

export interface SatimReconcileSummary {
  /** Orders that were asked about. */
  considered: number;

  /** Orders the gateway answered for. */
  confirmed: number;

  /** Orders left for the next run because the gateway could not be reached. */
  unreachable: number;

  /** Order ids the gateway reported as paid. */
  paid: string[];
}

const MINUTE_IN_MS = 60 * 1000;

/**
 * Confirms orders whose customer never came back.
 *
 * SATIM redirects the customer to the return URL, and that is where an
 * application normally calls acknowledge. A closed tab, a dead battery, or a
 * dropped connection means the redirect never happens, so the order stays
 * unconfirmed even though the card may well have been charged.
 *
 * This asks the gateway what actually happened and announces the answer. It
 * updates nothing of yours: listen for the reconciled event and settle the
 * order in your own records.
 *
 * It reads the audit trail to find the orders, so it does nothing while the
 * trail is switched off. Set reconcile.everyMs to have it run on its own, or
 * call run() from your own scheduler.
 */
@Injectable()
export class SatimReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SatimReconcileService.name);

  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SATIM_OPTIONS) private readonly options: ResolvedSatimOptions,
    @Inject(SATIM_EVENT_PUBLISHER) private readonly events: SatimEventPublisher,
    private readonly satim: SatimService,
    private readonly audit: SatimAuditService,
  ) {}

  onModuleInit(): void {
    const everyMs = this.options.reconcile.everyMs;

    if (everyMs === undefined) {
      return;
    }

    this.timer = setInterval(() => {
      void this.run().catch((error: unknown) => {
        this.logger.error(
          `The scheduled SATIM reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, everyMs);

    // Never a reason to hold the process open: a run missed at shutdown is
    // picked up by the next one, because the order is still unconfirmed.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Ask the gateway about each unconfirmed order and announce what it said.
   *
   * A gateway that cannot be reached is left for the next run rather than
   * throwing: the order is still unconfirmed, and a scheduled job that fails on
   * a passing network fault is noise.
   */
  async run(now: Date = new Date()): Promise<SatimReconcileSummary> {
    const summary: SatimReconcileSummary = {
      considered: 0,
      confirmed: 0,
      unreachable: 0,
      paid: [],
    };

    if (!this.audit.enabled) {
      this.logger.warn(
        'The SATIM audit trail is switched off, so there is no record of unconfirmed orders to work from.',
      );

      return summary;
    }

    const { afterMinutes, withinMinutes, limit } = this.options.reconcile;

    const orders = await this.audit.unconfirmed({
      registeredBefore: new Date(now.getTime() - afterMinutes * MINUTE_IN_MS),
      registeredAfter: new Date(now.getTime() - withinMinutes * MINUTE_IN_MS),
      limit,
    });

    summary.considered = orders.length;

    for (const order of orders) {
      const orderId = order.orderId;

      if (orderId === null) {
        continue;
      }

      let result;

      try {
        result = await this.satim.acknowledge(orderId);
      } catch (error) {
        if (!(error instanceof SatimConnectionError) && !(error instanceof SatimValidationError)) {
          throw error;
        }

        summary.unreachable++;
        this.logger.warn(`SATIM order [${orderId}] could not be reached: ${error.message}`);

        continue;
      }

      summary.confirmed++;

      if (result.paid()) {
        summary.paid.push(orderId);
      }

      await this.events.publish(
        SatimEventName.OrderReconciled,
        new SatimOrderReconciledEvent(orderId, result),
      );

      this.logger.log(
        `SATIM order [${orderId}] is ${
          result.paid()
            ? 'paid'
            : result.status === null
              ? 'unknown'
              : orderStatusName(result.status)
        }.`,
      );
    }

    return summary;
  }
}

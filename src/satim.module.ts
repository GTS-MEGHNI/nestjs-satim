import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';

import { SatimAuditService } from './audit.service.js';
import { InMemorySatimCallStore } from './call-store.js';
import { FetchSatimTransport } from './fetch-transport.js';
import { HookSatimEventPublisher } from './hook-event-publisher.js';
import type { SatimModuleOptions } from './options.js';
import { SatimReconcileService } from './reconcile.service.js';
import { resolveSatimOptions } from './resolve-options.js';
import { SatimService } from './satim.service.js';
import {
  SATIM_CALL_STORE,
  SATIM_EVENT_PUBLISHER,
  SATIM_OPTIONS,
  SATIM_TRANSPORT,
} from './tokens.js';

export interface SatimModuleExtras {
  /**
   * Providers appended after the defaults, so one binding SATIM_CALL_STORE or
   * SATIM_EVENT_PUBLISHER replaces the default for that token. This is where a
   * TypeORM or Prisma store adapter goes.
   */
  extraProviders?: Provider[];

  /** Register the module globally, so SatimService injects anywhere. */
  isGlobal?: boolean;
}

export interface SatimModuleAsyncOptions extends SatimModuleExtras {
  imports?: DynamicModule['imports'];
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: never[]) => Promise<SatimModuleOptions> | SatimModuleOptions;
}

const SERVICES = [SatimAuditService, SatimService, SatimReconcileService];

/**
 * Wires the gateway into an application.
 *
 * The options are validated as they are resolved, so an application missing a
 * key fails at boot with the name of the key rather than at checkout with a
 * rejected payment.
 */
@Module({})
export class SatimModule {
  static register(options: SatimModuleOptions, extras: SatimModuleExtras = {}): DynamicModule {
    return SatimModule.build(
      { provide: SATIM_OPTIONS, useValue: resolveSatimOptions(options) },
      extras,
    );
  }

  static registerAsync(options: SatimModuleAsyncOptions): DynamicModule {
    const module = SatimModule.build(
      {
        provide: SATIM_OPTIONS,
        useFactory: async (...args: never[]) =>
          resolveSatimOptions(await options.useFactory(...args)),
        inject: options.inject ?? [],
      },
      options,
    );

    return { ...module, imports: options.imports ?? [] };
  }

  private static build(optionsProvider: Provider, extras: SatimModuleExtras): DynamicModule {
    return {
      module: SatimModule,
      global: extras.isGlobal ?? false,
      providers: [
        optionsProvider,
        { provide: SATIM_TRANSPORT, useClass: FetchSatimTransport },
        // In memory by default, so an unconfigured application still runs; the
        // audit trail is then lost on restart, which production must not do.
        { provide: SATIM_CALL_STORE, useClass: InMemorySatimCallStore },
        { provide: SATIM_EVENT_PUBLISHER, useClass: HookSatimEventPublisher },
        ...SERVICES,
        ...(extras.extraProviders ?? []),
      ],
      exports: [
        ...SERVICES,
        SATIM_OPTIONS,
        SATIM_TRANSPORT,
        SATIM_CALL_STORE,
        SATIM_EVENT_PUBLISHER,
      ],
    };
  }
}

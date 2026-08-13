import 'reflect-metadata';

import { Test, type TestingModule } from '@nestjs/testing';

import { InMemorySatimCallStore } from '../src/call-store.js';
import type { SatimModuleOptions } from '../src/options.js';
import { SatimAuditService } from '../src/audit.service.js';
import { SatimReconcileService } from '../src/reconcile.service.js';
import { SatimModule } from '../src/satim.module.js';
import { SatimService } from '../src/satim.service.js';
import { SATIM_CALL_STORE, SATIM_TRANSPORT } from '../src/tokens.js';
import { SatimFake, type SatimFakeResponses } from '../src/testing/fake.js';

export const testOptions: SatimModuleOptions = {
  baseUrl: 'https://test2.satim.dz/payment/rest',
  username: 'merchant',
  password: 'secret',
  terminalId: 'E010900001',
  returnUrl: 'https://shop.test/satim/return',
  failUrl: 'https://shop.test/satim/fail',
  receiptLogo: '/assets/satim.png',
};

export interface Harness {
  moduleRef: TestingModule;
  satim: SatimService;
  audit: SatimAuditService;
  reconcile: SatimReconcileService;
  store: InMemorySatimCallStore;
  fake: SatimFake;
}

/**
 * A module with the gateway faked and everything above it real, which is the
 * only arrangement that proves a call production would refuse is refused here.
 */
export async function harness(
  responses: SatimFakeResponses = {},
  overrides: Partial<SatimModuleOptions> = {},
  /** Options to leave out entirely, as an application that never set them would. */
  omit: (keyof SatimModuleOptions)[] = [],
): Promise<Harness> {
  const fake = new SatimFake(responses);
  const store = new InMemorySatimCallStore();
  const options = { ...testOptions, ...overrides };

  for (const key of omit) {
    delete options[key];
  }

  const moduleRef = await Test.createTestingModule({
    imports: [
      SatimModule.register(options, {
        extraProviders: [
          { provide: SATIM_TRANSPORT, useValue: fake },
          { provide: SATIM_CALL_STORE, useValue: store },
        ],
      }),
    ],
  }).compile();

  await moduleRef.init();

  return {
    moduleRef,
    satim: moduleRef.get(SatimService),
    audit: moduleRef.get(SatimAuditService),
    reconcile: moduleRef.get(SatimReconcileService),
    store,
    fake,
  };
}

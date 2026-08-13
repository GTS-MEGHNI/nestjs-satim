import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { SatimAuditService } from '../src/audit.service.js';
import { checkSatimOptions } from '../src/check.js';
import { describeErrorCode, SatimErrorCode, isSuccessfulErrorCode } from '../src/error-code.js';
import { SatimConfigurationError } from '../src/errors.js';
import { SatimEventName } from '../src/events.js';
import { SatimOperation } from '../src/operation.js';
import {
  isReturnedStatus,
  orderStatusName,
  SatimOrderStatus,
  toSatimOrderStatus,
} from '../src/order-status.js';
import { resolveSatimOptions } from '../src/resolve-options.js';
import { SatimModule } from '../src/satim.module.js';
import { SatimService } from '../src/satim.service.js';
import { SATIM_CALL_STORE, SATIM_OPTIONS, SATIM_TRANSPORT } from '../src/tokens.js';
import { SatimFake } from '../src/testing/fake.js';
import { harness, testOptions } from './helpers.js';

describe('options', () => {
  it('applies the documented defaults', () => {
    const resolved = resolveSatimOptions(testOptions);

    expect(resolved.currency).toBe('012');
    expect(resolved.language).toBe('FR');
    expect(resolved.timeoutMs).toBe(30_000);
    expect(resolved.audit).toEqual({ enabled: true, retentionDays: 3650 });
    expect(resolved.reconcile).toEqual({ afterMinutes: 30, withinMinutes: 10_080, limit: 100 });
  });

  it('strips a trailing slash from the base URL', () => {
    expect(resolveSatimOptions({ ...testOptions, baseUrl: 'https://x.dz/rest//' }).baseUrl).toBe(
      'https://x.dz/rest',
    );
  });

  it.each([
    ['baseUrl', ''],
    ['username', '  '],
    ['password', ''],
    ['terminalId', ''],
    ['returnUrl', ''],
    ['failUrl', ''],
  ])('names %s when it is missing', (key, value) => {
    expect(() => resolveSatimOptions({ ...testOptions, [key]: value })).toThrow(key);
  });

  it.each([
    [{ baseUrl: 'not-a-url' }, 'absolute URL'],
    [{ baseUrl: 'http://test2.satim.dz' }, 'HTTPS'],
    [{ returnUrl: 'nope' }, 'redirect to'],
    [{ terminalId: 'x'.repeat(17) }, '16 characters'],
    [{ currency: '12' }, 'ISO 4217'],
    [{ language: 'DE' as never }, 'AR, FR and EN'],
    [{ timeoutMs: 0 }, 'positive number'],
    [{ audit: { retentionDays: 0 } }, 'positive number'],
    [{ reconcile: { limit: -1 } }, 'positive number'],
  ])('refuses %o', (overrides, expected) => {
    expect(() => resolveSatimOptions({ ...testOptions, ...overrides })).toThrow(expected);
  });

  it('describes valid options with the password masked', () => {
    const result = checkSatimOptions(testOptions);

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.settings).toContainEqual(['password', '********']);
    expect(result.settings).toContainEqual(['audit.retentionDays', '3650']);
  });

  it('reports why invalid options were refused instead of throwing', () => {
    const result = checkSatimOptions({ ...testOptions, terminalId: '' });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('terminalId');
    expect(result.settings).toEqual([]);
  });

  it('says so when the trail is set to keep everything forever', () => {
    const result = checkSatimOptions({ ...testOptions, audit: { retentionDays: null } });

    expect(result.settings).toContainEqual(['audit.retentionDays', 'forever']);
  });

  it('validates the options a factory returns, at boot', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          SatimModule.registerAsync({ useFactory: () => ({ ...testOptions, username: '' }) }),
        ],
      }).compile(),
    ).rejects.toThrow(SatimConfigurationError);
  });

  it('builds a working module from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        SatimModule.registerAsync({
          isGlobal: true,
          useFactory: () => testOptions,
          extraProviders: [{ provide: SATIM_TRANSPORT, useValue: new SatimFake() }],
        }),
      ],
    }).compile();

    expect(moduleRef.get(SatimService)).toBeInstanceOf(SatimService);
    expect(moduleRef.get(SatimAuditService)).toBeInstanceOf(SatimAuditService);
    expect(moduleRef.get(SATIM_OPTIONS)).toMatchObject({ currency: '012' });
    expect(moduleRef.get(SATIM_CALL_STORE)).toBeDefined();
  });
});

describe('events', () => {
  it('calls a hook for every stage of a call', async () => {
    const seen: string[] = [];
    const { satim } = await harness(
      {},
      {
        hooks: {
          onCallStarted: (event) => void seen.push(`started:${event.operation}`),
          onCallCompleted: (event) => void seen.push(`completed:${event.successful}`),
        },
      },
    );

    await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    expect(seen).toEqual(['started:register', 'completed:true']);
  });

  it('never lets a throwing hook fail a payment the gateway accepted', async () => {
    const { satim } = await harness(
      {},
      {
        hooks: {
          onCallCompleted: () => {
            throw new Error('the bookkeeping broke');
          },
        },
      },
    );

    await expect(
      satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 }),
    ).resolves.toMatchObject({ orderId: 'V721uPPfNNofVQAAABL3' });
  });

  it('reports a failed call through the failure hook', async () => {
    const reasons: string[] = [];
    const { satim } = await harness(
      {
        register: (
          await import('../src/testing/fake-response.js')
        ).SatimFakeResponse.connectionFailure('gone'),
      },
      { hooks: { onCallFailed: (event) => void reasons.push(event.reason) } },
    );

    await expect(satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 })).rejects.toThrow(
      'gone',
    );
    expect(reasons).toEqual(['gone']);
  });

  it('names every event under the satim prefix', () => {
    expect(Object.values(SatimEventName).every((name) => name.startsWith('satim.'))).toBe(true);
  });
});

describe('error codes and statuses', () => {
  it('reads code 5 differently on every endpoint', () => {
    expect(describeErrorCode(SatimErrorCode.InvalidParameter, SatimOperation.Register)).toContain(
      'jsonParams',
    );
    expect(
      describeErrorCode(SatimErrorCode.InvalidParameter, SatimOperation.Acknowledge),
    ).toContain('order id was empty');
    expect(describeErrorCode(SatimErrorCode.InvalidParameter, SatimOperation.Refund)).toContain(
      'refund amount is not allowed',
    );
  });

  it('reads code 7 differently on a refund', () => {
    expect(describeErrorCode(SatimErrorCode.SystemError, SatimOperation.Refund)).toContain(
      'allows a refund',
    );
    expect(describeErrorCode(SatimErrorCode.SystemError, SatimOperation.Register)).toBe(
      'System error.',
    );
  });

  it('describes every code it names', () => {
    for (const code of Object.values(SatimErrorCode)) {
      expect(describeErrorCode(code, SatimOperation.Register).length).toBeGreaterThan(0);
    }

    expect(isSuccessfulErrorCode(SatimErrorCode.None)).toBe(true);
    expect(isSuccessfulErrorCode(SatimErrorCode.Declined)).toBe(false);
  });

  it('names a status and treats refunds and reversals as returned money', () => {
    expect(orderStatusName(SatimOrderStatus.Deposited)).toBe('Deposited');
    expect(orderStatusName(99 as SatimOrderStatus)).toBe('99');
    expect(isReturnedStatus(SatimOrderStatus.Refunded)).toBe(true);
    expect(isReturnedStatus(SatimOrderStatus.Reversed)).toBe(true);
    expect(isReturnedStatus(SatimOrderStatus.Deposited)).toBe(false);
    expect(toSatimOrderStatus(99)).toBeNull();
    expect(toSatimOrderStatus(null)).toBeNull();
  });
});

describe('order numbers', () => {
  it('generates ten alphanumeric characters', async () => {
    const { satim } = await harness();

    const numbers = new Set(await Promise.all([1, 2, 3, 4, 5].map(() => satim.orderNumber())));

    expect(numbers.size).toBe(5);
    for (const number of numbers) {
      expect(number).toMatch(/^[A-Za-z0-9]{10}$/u);
    }
  });

  it('treats every number as free while the trail is off', async () => {
    const { satim, store } = await harness({}, { audit: { enabled: false } });
    const spy = vi.spyOn(store, 'hasOrderNumber');

    await satim.orderNumber();

    expect(spy).not.toHaveBeenCalled();
  });
});

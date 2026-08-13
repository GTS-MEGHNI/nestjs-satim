import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import {
  InMemorySatimCallStore,
  type SatimCallStarted,
  type SatimCallStore,
} from '../src/call-store.js';
import { SatimOperation } from '../src/operation.js';
import { PrismaSatimCallStore } from '../src/prisma/prisma-call-store.js';
import { SatimCallEntity } from '../src/typeorm/satim-call.entity.js';
import { TypeOrmSatimCallStore } from '../src/typeorm/typeorm-call-store.js';
import { fakePrismaDelegate } from './prisma-delegate.js';

const HOUR_IN_MS = 60 * 60 * 1000;

function started(overrides: Partial<SatimCallStarted> = {}): SatimCallStarted {
  return {
    callId: 'call-1',
    operation: SatimOperation.Register,
    orderNumber: 'K9m2X7qL4P',
    orderId: null,
    amountInCentimes: 100_000,
    request: { userName: '[REDACTED]' },
    createdAt: new Date(Date.now() - HOUR_IN_MS),
    ...overrides,
  };
}

/**
 * Every store answers the same questions, so they are held to the same test:
 * an adapter that passes here can be swapped in without the reconciler or the
 * order state behaving differently.
 */
function behavesLikeACallStore(name: string, make: () => Promise<SatimCallStore>): void {
  // eslint-disable-next-line vitest/valid-title
  describe(name, () => {
    let store: SatimCallStore;

    beforeEach(async () => {
      store = await make();
    });

    it('records a call, then completes it with the answer', async () => {
      await store.start(started());
      await store.complete({
        callId: 'call-1',
        orderId: 'order-1',
        response: { orderId: 'order-1', errorCode: '0' },
        successful: true,
        errorCode: '0',
        errorMessage: null,
        orderStatus: null,
        completedAt: new Date(),
      });

      const [record] = await store.callsForOrder('order-1');

      expect(record?.callId).toBe('call-1');
      expect(record?.orderNumber).toBe('K9m2X7qL4P');
      expect(record?.amountInCentimes).toBe(100_000);
      expect(record?.successful).toBe(true);
      expect(record?.response).toEqual({ orderId: 'order-1', errorCode: '0' });
      expect(record?.completedAt).toBeInstanceOf(Date);
      expect(record?.request).toEqual({ userName: '[REDACTED]' });
    });

    it('keeps the order id already recorded when the answer carries none', async () => {
      await store.start(started({ orderId: 'order-1' }));
      await store.complete({
        callId: 'call-1',
        orderId: null,
        response: {},
        successful: false,
        errorCode: '7',
        errorMessage: 'System error',
        orderStatus: null,
        completedAt: new Date(),
      });

      expect(await store.callsForOrder('order-1')).toHaveLength(1);
    });

    it('marks a call that never came back, leaving it uncompleted', async () => {
      await store.start(started({ orderId: 'order-1' }));
      await store.fail('call-1', 'The operation timed out');

      const [record] = await store.callsForOrder('order-1');

      expect(record?.successful).toBe(false);
      expect(record?.failureReason).toBe('The operation timed out');
      expect(record?.completedAt).toBeNull();
    });

    it('knows which order numbers were already sent', async () => {
      await store.start(started());

      expect(await store.hasOrderNumber('K9m2X7qL4P')).toBe(true);
      expect(await store.hasOrderNumber('neversent1')).toBe(false);
    });

    it('finds a register nothing ever answered for', async () => {
      await store.start(started({ orderId: 'order-1' }));
      await store.complete({
        callId: 'call-1',
        orderId: 'order-1',
        response: {},
        successful: true,
        errorCode: '0',
        errorMessage: null,
        orderStatus: null,
        completedAt: new Date(Date.now() - HOUR_IN_MS),
      });

      const unconfirmed = await store.unconfirmed({
        registeredBefore: new Date(),
        registeredAfter: new Date(Date.now() - 2 * HOUR_IN_MS),
        limit: 10,
      });

      expect(unconfirmed.map((record) => record.orderId)).toEqual(['order-1']);
    });

    it('leaves out an order a completed acknowledge already answered for', async () => {
      await store.start(started({ orderId: 'order-1' }));
      await store.complete({
        callId: 'call-1',
        orderId: 'order-1',
        response: {},
        successful: true,
        errorCode: '0',
        errorMessage: null,
        orderStatus: null,
        completedAt: new Date(Date.now() - HOUR_IN_MS),
      });

      await store.start(
        started({ callId: 'call-2', operation: SatimOperation.Acknowledge, orderId: 'order-1' }),
      );
      await store.complete({
        callId: 'call-2',
        orderId: 'order-1',
        response: {},
        successful: true,
        errorCode: '0',
        errorMessage: null,
        orderStatus: 2,
        completedAt: new Date(),
      });

      const unconfirmed = await store.unconfirmed({
        registeredBefore: new Date(),
        registeredAfter: new Date(Date.now() - 2 * HOUR_IN_MS),
        limit: 10,
      });

      expect(unconfirmed).toEqual([]);
    });

    it('leaves out a register that failed, and one outside the window', async () => {
      await store.start(started({ callId: 'failed', orderId: 'order-failed' }));
      await store.fail('failed', 'gone');

      await store.start(
        started({
          callId: 'old',
          orderId: 'order-old',
          createdAt: new Date(Date.now() - 10 * HOUR_IN_MS),
        }),
      );
      await store.complete({
        callId: 'old',
        orderId: 'order-old',
        response: {},
        successful: true,
        errorCode: '0',
        errorMessage: null,
        orderStatus: null,
        completedAt: new Date(Date.now() - 10 * HOUR_IN_MS),
      });

      const unconfirmed = await store.unconfirmed({
        registeredBefore: new Date(),
        registeredAfter: new Date(Date.now() - 2 * HOUR_IN_MS),
        limit: 10,
      });

      expect(unconfirmed).toEqual([]);
    });

    it('deletes only what is older than the cutoff', async () => {
      await store.start(
        started({ callId: 'old', createdAt: new Date(Date.now() - 5 * HOUR_IN_MS) }),
      );
      await store.start(started({ callId: 'recent', createdAt: new Date() }));

      expect(await store.prune(new Date(Date.now() - HOUR_IN_MS))).toBe(1);
      expect(await store.hasOrderNumber('K9m2X7qL4P')).toBe(true);
    });
  });
}

behavesLikeACallStore('in memory store', () => Promise.resolve(new InMemorySatimCallStore()));

behavesLikeACallStore('prisma store', () =>
  Promise.resolve(new PrismaSatimCallStore(fakePrismaDelegate())),
);

describe('typeorm store', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [SatimCallEntity],
      synchronize: true,
    });

    await dataSource.initialize();
  });

  afterEach(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });

  behavesLikeACallStore('against sqlite', () =>
    Promise.resolve(new TypeOrmSatimCallStore(dataSource.getRepository(SatimCallEntity))),
  );

  it('reads the column names from the entity metadata', async () => {
    const store = new TypeOrmSatimCallStore(dataSource.getRepository(SatimCallEntity));

    await store.start(started({ orderId: 'order-1' }));

    // The subquery in unconfirmed() is written from metadata, so this proves it
    // runs at all rather than throwing on an unknown column.
    await expect(
      store.unconfirmed({
        registeredBefore: new Date(),
        registeredAfter: new Date(Date.now() - HOUR_IN_MS * 2),
        limit: 5,
      }),
    ).resolves.toEqual([]);
  });
});

describe('in memory store', () => {
  it('ignores a completion or a failure for a call it never recorded', async () => {
    const store = new InMemorySatimCallStore();

    await store.complete({
      callId: 'unknown',
      orderId: null,
      response: {},
      successful: true,
      errorCode: null,
      errorMessage: null,
      orderStatus: null,
      completedAt: new Date(),
    });
    await store.fail('unknown', 'gone');

    expect(store.all()).toEqual([]);
  });
});

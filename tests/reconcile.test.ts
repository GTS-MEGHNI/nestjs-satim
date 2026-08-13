import { describe, expect, it, vi } from 'vitest';

import { InMemorySatimCallStore } from '../src/call-store.js';
import { SatimEventName } from '../src/events.js';
import { SatimOperation } from '../src/operation.js';
import { SatimFakeResponse } from '../src/testing/fake-response.js';
import { harness } from './helpers.js';

const HOUR_IN_MS = 60 * 60 * 1000;

/** An order registered an hour ago, which no acknowledge ever answered for. */
async function unconfirmedOrder(store: InMemorySatimCallStore, orderId: string): Promise<void> {
  const createdAt = new Date(Date.now() - HOUR_IN_MS);

  await store.start({
    callId: `call-${orderId}`,
    operation: SatimOperation.Register,
    orderNumber: 'K9m2X7qL4P',
    orderId: null,
    amountInCentimes: 100_000,
    request: {},
    createdAt,
  });

  await store.complete({
    callId: `call-${orderId}`,
    orderId,
    response: { orderId },
    successful: true,
    errorCode: '0',
    errorMessage: null,
    orderStatus: null,
    completedAt: createdAt,
  });
}

describe('reconcile', () => {
  it('asks the gateway about an order nobody confirmed and announces the answer', async () => {
    const reconciled: string[] = [];
    const { reconcile, store, fake } = await harness(
      {},
      { hooks: { onOrderReconciled: (event) => void reconciled.push(event.orderId) } },
    );

    await unconfirmedOrder(store, 'V721uPPfNNofVQAAABL3');

    const summary = await reconcile.run();

    expect(summary).toEqual({
      considered: 1,
      confirmed: 1,
      unreachable: 0,
      paid: ['V721uPPfNNofVQAAABL3'],
    });
    expect(reconciled).toEqual(['V721uPPfNNofVQAAABL3']);
    fake.assertAcknowledged('V721uPPfNNofVQAAABL3');
  });

  it('leaves an unreachable order for the next run instead of throwing', async () => {
    const { reconcile, store, fake } = await harness({
      acknowledge: SatimFakeResponse.connectionFailure(),
    });

    await unconfirmedOrder(store, 'V721uPPfNNofVQAAABL3');

    const summary = await reconcile.run();

    expect(summary.unreachable).toBe(1);
    expect(summary.confirmed).toBe(0);
    fake.assertSentCount(1);
  });

  it('ignores an order a completed acknowledge already answered for', async () => {
    const { satim, reconcile, store } = await harness();

    await unconfirmedOrder(store, 'V721uPPfNNofVQAAABL3');
    await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect((await reconcile.run()).considered).toBe(0);
  });

  it('ignores an order too recent to ask about', async () => {
    const { reconcile, store } = await harness({}, { reconcile: { afterMinutes: 120 } });

    await unconfirmedOrder(store, 'V721uPPfNNofVQAAABL3');

    expect((await reconcile.run()).considered).toBe(0);
  });

  it('ignores an order old enough that no answer will ever change', async () => {
    const { reconcile, store } = await harness({}, { reconcile: { withinMinutes: 10 } });

    await unconfirmedOrder(store, 'V721uPPfNNofVQAAABL3');

    expect((await reconcile.run()).considered).toBe(0);
  });

  it('never asks about more orders than the limit allows', async () => {
    const { reconcile, store } = await harness({}, { reconcile: { limit: 1 } });

    await unconfirmedOrder(store, 'order-one');
    await unconfirmedOrder(store, 'order-two');

    expect((await reconcile.run()).considered).toBe(1);
  });

  it('does nothing at all while the audit trail is switched off', async () => {
    const { reconcile, fake } = await harness({}, { audit: { enabled: false } });

    expect((await reconcile.run()).considered).toBe(0);
    fake.assertNothingSent();
  });

  it('runs on its own when an interval is configured, and stops on shutdown', async () => {
    vi.useFakeTimers();

    try {
      const { moduleRef, reconcile, store } = await harness({}, { reconcile: { everyMs: 1000 } });
      const spy = vi.spyOn(reconcile, 'run');

      await unconfirmedOrder(store, 'V721uPPfNNofVQAAABL3');

      await vi.advanceTimersByTimeAsync(1000);
      expect(spy).toHaveBeenCalledTimes(1);

      await moduleRef.close();
      await vi.advanceTimersByTimeAsync(5000);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('names its own events so a listener can subscribe to them', () => {
    expect(SatimEventName.OrderReconciled).toBe('satim.order.reconciled');
  });
});

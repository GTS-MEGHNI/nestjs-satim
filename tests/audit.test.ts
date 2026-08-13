import { describe, expect, it, vi } from 'vitest';

import { SatimConnectionError } from '../src/errors.js';
import { SatimOperation } from '../src/operation.js';
import { SatimFakeResponse } from '../src/testing/fake-response.js';
import { harness } from './helpers.js';

describe('audit trail', () => {
  it('records a call before it is sent and completes it when the answer arrives', async () => {
    const { satim, store } = await harness();

    const result = await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    const [record] = await store.callsForOrder(result.orderId as string);
    expect(record?.operation).toBe(SatimOperation.Register);
    expect(record?.orderNumber).toBe('K9m2X7qL4P');
    expect(record?.amountInCentimes).toBe(100_000);
    expect(record?.successful).toBe(true);
    expect(record?.completedAt).not.toBeNull();
    expect(record?.request['password']).toBe('[REDACTED]');
  });

  it('leaves a call that never came back marked failed and never completed', async () => {
    const { satim, store } = await harness({
      register: SatimFakeResponse.connectionFailure('The operation timed out'),
    });

    await expect(satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 })).rejects.toThrow(
      SatimConnectionError,
    );

    // The evidence a reconciler needs: recorded, unsuccessful, and with no
    // completion time, because money may have moved anyway.
    const [record] = store.all();
    expect(record?.orderNumber).toBe('K9m2X7qL4P');
    expect(record?.successful).toBe(false);
    expect(record?.completedAt).toBeNull();
    expect(record?.failureReason).toBe('The operation timed out');
    expect(record?.response).toBeNull();
  });

  it('builds the order state from the recorded calls', async () => {
    const { satim, audit } = await harness();

    const registered = await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });
    const orderId = registered.orderId as string;

    await satim.acknowledge(orderId);
    await satim.refund(orderId, 400);
    await satim.refund(orderId, 100);

    const state = await audit.stateFor(orderId);

    expect(state.registered()).toBe(true);
    expect(state.acknowledged()).toBe(true);
    expect(state.paid()).toBe(true);
    expect(state.refunded()).toBe(true);
    expect(state.refundedInCentimes()).toBe(50_000);
    expect(state.orderStatus()).toBe(2);
    expect(state.unanswered()).toHaveLength(0);
    expect(state.lastCallAt()).toBeInstanceOf(Date);
  });

  it('never sends an order number it already recorded', async () => {
    const { satim, store } = await harness();

    const first = await satim.orderNumber();
    await satim.register({ orderNumber: first, amount: 1000 });

    const spy = vi.spyOn(store, 'hasOrderNumber');
    const second = await satim.orderNumber();

    expect(second).not.toBe(first);
    expect(spy).toHaveBeenCalled();
    expect(second).toMatch(/^[A-Za-z0-9]{10}$/u);
  });

  it('gives up rather than looping forever when every number is taken', async () => {
    const { satim, store } = await harness();

    vi.spyOn(store, 'hasOrderNumber').mockResolvedValue(true);

    await expect(satim.orderNumber(3)).rejects.toThrow('in 3 attempts');
  });

  it('touches the store not at all when the trail is switched off', async () => {
    const { satim, store, audit } = await harness({}, { audit: { enabled: false } });
    const spy = vi.spyOn(store, 'start');

    await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    expect(spy).not.toHaveBeenCalled();
    expect(audit.enabled).toBe(false);
    expect(await audit.prune()).toBe(0);
  });

  it('prunes records past the retention period and keeps the rest', async () => {
    const { satim, audit, store } = await harness({}, { audit: { retentionDays: 30 } });

    await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    expect(await audit.prune()).toBe(0);

    const future = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await audit.prune(future)).toBe(1);
    expect(await store.callsForOrder('V721uPPfNNofVQAAABL3')).toHaveLength(0);
  });

  it('keeps everything when the retention is null', async () => {
    const { satim, audit } = await harness({}, { audit: { retentionDays: null } });

    await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    const future = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
    expect(await audit.prune(future)).toBe(0);
  });
});

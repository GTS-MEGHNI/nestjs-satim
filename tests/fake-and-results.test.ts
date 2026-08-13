import 'reflect-metadata';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it } from 'vitest';

import { SatimEventEmitterPublisher } from '../src/event-emitter/event-emitter-publisher.js';
import { SatimCallFailedEvent, SatimEventName } from '../src/events.js';
import { SatimLanguage, isSatimLanguage } from '../src/language.js';
import { messagesFor, SATIM_MESSAGES } from '../src/messages.js';
import { endpointFor, SatimOperation } from '../src/operation.js';
import { intValue, paramsOf, stringValue } from '../src/response-reader.js';
import { AcknowledgeResult } from '../src/results/acknowledge-result.js';
import { SatimOrderState } from '../src/results/order-state.js';
import { SatimFake } from '../src/testing/fake.js';
import { SatimFakeResponse } from '../src/testing/fake-response.js';
import { SatimRecordedCall } from '../src/testing/recorded-call.js';

describe('fake transport', () => {
  it('answers with a success for an operation no test staged', async () => {
    const fake = new SatimFake();

    await expect(fake.post(SatimOperation.Register, {})).resolves.toMatchObject({
      orderId: 'V721uPPfNNofVQAAABL3',
    });
    await expect(fake.post(SatimOperation.Refund, {})).resolves.toEqual({ errorCode: '0' });
  });

  it('consumes a queue in order and keeps answering with its last entry', async () => {
    const fake = new SatimFake({
      acknowledge: [SatimFakeResponse.declined(), SatimFakeResponse.paid()],
    });

    const first = await fake.post(SatimOperation.Acknowledge, {});
    const second = await fake.post(SatimOperation.Acknowledge, {});
    const third = await fake.post(SatimOperation.Acknowledge, {});

    expect(first['OrderStatus']).toBe(6);
    expect(second['OrderStatus']).toBe(2);
    expect(third['OrderStatus']).toBe(2);
  });

  it('redacts the credentials it recorded', async () => {
    const fake = new SatimFake();

    await fake.post(SatimOperation.Register, { userName: 'merchant', password: 'secret' });

    expect(fake.recorded()[0]?.payload).toMatchObject({
      userName: '[REDACTED]',
      password: '[REDACTED]',
    });
  });

  it('throws what a staged connection failure describes', async () => {
    const fake = new SatimFake({ refund: SatimFakeResponse.connectionFailure('gone') });

    await expect(fake.post(SatimOperation.Refund, {})).rejects.toThrow('gone');
    expect(fake.recorded(SatimOperation.Refund)).toHaveLength(1);
  });

  it('fails an assertion for a call that was not made, and passes for one that was', async () => {
    const fake = new SatimFake();

    expect(() => fake.assertRegistered()).toThrow('was not sent');
    fake.assertNothingSent();
    fake.assertNotSent(SatimOperation.Refund);

    await fake.post(SatimOperation.Register, { orderNumber: 'K9m2X7qL4P' });
    await fake.post(SatimOperation.Refund, { orderId: 'order-1', amount: '25050' });

    fake.assertRegistered((call) => call.orderNumber() === 'K9m2X7qL4P');
    fake.assertRefunded('order-1', 250.5);
    fake.assertSentCount(2);

    expect(() => fake.assertNothingSent()).toThrow('none were expected');
    expect(() => fake.assertSentCount(5)).toThrow('exactly 5 were expected');
    expect(() => fake.assertNotSent(SatimOperation.Refund)).toThrow('was not expected to be');
    expect(() => fake.assertRefunded('order-1', 999)).toThrow('was not sent');
  });

  it('matches an acknowledged order by id or by callback', async () => {
    const fake = new SatimFake();

    await fake.post(SatimOperation.Acknowledge, { mdOrder: 'order-1' });

    fake.assertAcknowledged('order-1');
    fake.assertAcknowledged((call) => call.orderId() === 'order-1');
    expect(() => fake.assertAcknowledged('order-2')).toThrow('was not sent');
  });
});

describe('recorded call', () => {
  it('reads what each endpoint calls the same thing', () => {
    const register = new SatimRecordedCall(SatimOperation.Register, endpointFor('register'), {
      orderNumber: 'K9m2X7qL4P',
      amount: '100000',
      jsonParams: JSON.stringify({ force_terminal_id: 'E010900001' }),
    });

    expect(register.orderNumber()).toBe('K9m2X7qL4P');
    expect(register.orderId()).toBeNull();
    expect(register.amountInCentimes()).toBe(100_000);
    expect(register.jsonParams()).toEqual({ force_terminal_id: 'E010900001' });

    const refund = new SatimRecordedCall(SatimOperation.Refund, endpointFor('refund'), {
      orderId: 'order-1',
    });

    expect(refund.orderId()).toBe('order-1');
    expect(refund.orderNumber()).toBeNull();
    expect(refund.amountInCentimes()).toBeNull();
    expect(refund.jsonParams()).toEqual({});
    expect(refund.response).toEqual({});
  });
});

describe('response reader', () => {
  it('reads a value SATIM sent as a number as a string', () => {
    expect(stringValue({ actionCode: -1 }, 'actionCode')).toBe('-1');
    expect(stringValue({ empty: '  ' }, 'empty')).toBeNull();
    expect(stringValue({}, 'missing')).toBeNull();
    expect(stringValue({ nested: { a: 1 } }, 'nested')).toBeNull();
  });

  it('reads a number SATIM sent as a string as a number', () => {
    expect(intValue({ Amount: '100000' }, 'Amount')).toBe(100_000);
    expect(intValue({ Amount: 100_000 }, 'Amount')).toBe(100_000);
    expect(intValue({ Amount: 'many' }, 'Amount')).toBeNull();
    expect(intValue({ Amount: '' }, 'Amount')).toBeNull();
    expect(intValue({ Amount: 1.5 }, 'Amount')).toBeNull();
    expect(intValue({}, 'Amount')).toBeNull();
  });

  it('treats a missing or unusable params object as empty', () => {
    expect(paramsOf({ params: { respCode: '00' } })).toEqual({ respCode: '00' });
    expect(paramsOf({ params: 'no' })).toEqual({});
    expect(paramsOf({ params: [1] })).toEqual({});
    expect(paramsOf({})).toEqual({});
  });
});

describe('order state', () => {
  it('reports nothing for an order with no recorded calls', () => {
    const state = new SatimOrderState('order-1', []);

    expect(state.registered()).toBe(false);
    expect(state.acknowledged()).toBe(false);
    expect(state.paid()).toBe(false);
    expect(state.refunded()).toBe(false);
    expect(state.refundedInCentimes()).toBe(0);
    expect(state.orderStatus()).toBeNull();
    expect(state.unanswered()).toEqual([]);
    expect(state.lastCallAt()).toBeNull();
  });
});

describe('acknowledge result', () => {
  it('falls back to the action code description when there is no respCode_desc', () => {
    const result = AcknowledgeResult.fromResponse(
      'order-1',
      { actionCodeDescription: 'Insufficient funds', ErrorCode: '0' },
      {},
      'rejected',
    );

    expect(result.message).toBe('Insufficient funds');
    expect(result.paid()).toBe(false);
    expect(result.refunded()).toBe(false);
    expect(result.cancelled()).toBe(false);
    expect(result.amount).toBeNull();
  });
});

describe('languages and messages', () => {
  it('carries both mandated strings in all three languages', () => {
    for (const language of Object.values(SatimLanguage)) {
      expect(messagesFor(language).supportMessage).toContain('3020');
      expect(messagesFor(language).transactionRejected.length).toBeGreaterThan(0);
    }

    expect(Object.keys(SATIM_MESSAGES)).toHaveLength(3);
    expect(isSatimLanguage('FR')).toBe(true);
    expect(isSatimLanguage('DE')).toBe(false);
  });
});

describe('event emitter bridge', () => {
  it('emits every event under its own name', () => {
    const emitter = new EventEmitter2({ wildcard: true });
    const seen: string[] = [];

    emitter.on('satim.**', function listener(this: { event: string }) {
      seen.push(this.event);
    });

    const publisher = new SatimEventEmitterPublisher(emitter);
    publisher.publish(
      SatimEventName.CallFailed,
      new SatimCallFailedEvent('call-1', SatimOperation.Register, 'gone'),
    );

    expect(seen).toEqual([SatimEventName.CallFailed]);
  });
});

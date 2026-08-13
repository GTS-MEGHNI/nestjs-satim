import { describe, expect, it } from 'vitest';

import { SatimValidationError } from '../src/errors.js';
import { SatimErrorCode } from '../src/error-code.js';
import { SatimOperation } from '../src/operation.js';
import { MINIMUM_AMOUNT_IN_CENTIMES } from '../src/satim.service.js';
import { SatimFakeResponse } from '../src/testing/fake-response.js';
import { harness } from './helpers.js';

describe('register', () => {
  it('sends the credentials, the amount in centimes, and the configured URLs', async () => {
    const { satim, fake } = await harness();

    const result = await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    expect(result.successful()).toBe(true);
    expect(result.orderId).toBe('V721uPPfNNofVQAAABL3');
    expect(result.formUrl).toContain('mdOrder=V721uPPfNNofVQAAABL3');

    const [call] = fake.recorded(SatimOperation.Register);
    expect(call?.payload['amount']).toBe('100000');
    expect(call?.payload['currency']).toBe('012');
    expect(call?.payload['returnUrl']).toBe('https://shop.test/satim/return');
    expect(call?.payload['failUrl']).toBe('https://shop.test/satim/fail');
    expect(call?.payload['language']).toBe('FR');
    expect(call?.endpoint).toBe('register.do');
  });

  it('puts the terminal id and the udf slots in jsonParams', async () => {
    const { satim, fake } = await harness();

    await satim.register({
      orderNumber: 'K9m2X7qL4P',
      amount: 1000,
      udf2: 'invoice-42',
      fundingTypeIndicator: 'CP',
    });

    const [call] = fake.recorded(SatimOperation.Register);
    expect(call?.jsonParams()).toEqual({
      force_terminal_id: 'E010900001',
      udf1: 'K9m2X7qL4P',
      udf2: 'invoice-42',
      fundingTypeIndicator: 'CP',
    });
  });

  it('keeps the credentials out of the payload it hands back', async () => {
    const { satim } = await harness();

    const result = await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    expect(result.rawRequest['userName']).toBe('[REDACTED]');
    expect(result.rawRequest['password']).toBe('[REDACTED]');
  });

  it('reports a gateway rejection through the result rather than by throwing', async () => {
    const { satim } = await harness({ register: SatimFakeResponse.registerFailed() });

    const result = await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    expect(result.failed()).toBe(true);
    expect(result.orderId).toBeNull();
    expect(result.error()).toBe(SatimErrorCode.OrderAlreadyProcessed);
  });

  it('refuses an order number that is not 10 alphanumeric characters', async () => {
    const { satim, fake } = await harness();

    await expect(satim.register({ orderNumber: 'too-short', amount: 1000 })).rejects.toThrow(
      SatimValidationError,
    );
    fake.assertNothingSent();
  });

  it('refuses an amount below the gateway minimum', async () => {
    const { satim, fake } = await harness();

    await expect(satim.register({ orderNumber: 'K9m2X7qL4P', amount: 49 })).rejects.toThrow(
      `below the gateway minimum of ${MINIMUM_AMOUNT_IN_CENTIMES} centimes`,
    );
    fake.assertNothingSent();
  });

  it('accepts exactly the minimum amount', async () => {
    const { satim, fake } = await harness();

    await satim.register({ orderNumber: 'K9m2X7qL4P', amount: '50' });

    expect(fake.recorded(SatimOperation.Register)[0]?.payload['amount']).toBe('5000');
  });

  it('refuses a non numeric amount', async () => {
    const { satim } = await harness();

    await expect(satim.register({ orderNumber: 'K9m2X7qL4P', amount: 'free' })).rejects.toThrow(
      SatimValidationError,
    );
  });

  it('refuses a udf value longer than 20 characters', async () => {
    const { satim, fake } = await harness();

    await expect(
      satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000, udf3: 'x'.repeat(21) }),
    ).rejects.toThrow('[udf3] is 21 characters long');
    fake.assertNothingSent();
  });

  it('refuses a language the gateway does not accept', async () => {
    const { satim } = await harness();

    await expect(
      satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000, language: 'de' }),
    ).rejects.toThrow('supported languages are AR, FR and EN');
  });

  it('accepts a language in any case and sends it upper case', async () => {
    const { satim, fake } = await harness();

    await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000, language: 'ar' });

    expect(fake.recorded(SatimOperation.Register)[0]?.payload['language']).toBe('AR');
  });

  it('omits a description that was not given', async () => {
    const { satim, fake } = await harness();

    await satim.register({ orderNumber: 'K9m2X7qL4P', amount: 1000 });

    expect(fake.recorded(SatimOperation.Register)[0]?.payload).not.toHaveProperty('description');
  });
});

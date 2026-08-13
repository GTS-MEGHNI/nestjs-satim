import { describe, expect, it } from 'vitest';

import { SatimErrorCode } from '../src/error-code.js';
import { SatimConfigurationError, SatimValidationError } from '../src/errors.js';
import { SatimLanguage } from '../src/language.js';
import { SatimOperation } from '../src/operation.js';
import { SATIM_PAYMENT_METHOD } from '../src/results/receipt.js';
import { SatimFakeResponse } from '../src/testing/fake-response.js';
import { harness } from './helpers.js';

describe('refund', () => {
  it('sends the order id and the amount in centimes', async () => {
    const { satim, fake } = await harness();

    const result = await satim.refund('V721uPPfNNofVQAAABL3', 250.5);

    expect(result.successful()).toBe(true);
    expect(result.amountInCentimes).toBe(25_050);
    expect(result.amount).toBe(250.5);

    fake.assertRefunded('V721uPPfNNofVQAAABL3', 250.5);
    expect(fake.recorded(SatimOperation.Refund)[0]?.endpoint).toBe('refund.do');
  });

  it('reports a refusal through the result', async () => {
    const { satim } = await harness({ refund: SatimFakeResponse.refundFailed() });

    const result = await satim.refund('V721uPPfNNofVQAAABL3', 1000);

    expect(result.failed()).toBe(true);
    expect(result.error()).toBe(SatimErrorCode.SystemError);
    expect(result.errorMessage).toBe('Payment must be in a correct state');
  });

  it('counts an answer with no error code at all as a failure', async () => {
    const { satim } = await harness({ refund: SatimFakeResponse.make({}) });

    const result = await satim.refund('V721uPPfNNofVQAAABL3', 1000);

    expect(result.successful()).toBe(false);
    expect(result.error()).toBeNull();
  });

  it('refuses an empty order id', async () => {
    const { satim, fake } = await harness();

    await expect(satim.refund('', 1000)).rejects.toThrow(SatimValidationError);
    fake.assertNothingSent();
  });
});

describe('receipt', () => {
  it('carries every field the certification checklist expects', async () => {
    const { satim } = await harness();
    const paidAt = new Date('2026-03-01T10:30:00.000Z');

    const receipt = satim.receipt(await satim.acknowledge('V721uPPfNNofVQAAABL3'), paidAt);

    expect(receipt.orderId).toBe('V721uPPfNNofVQAAABL3');
    expect(receipt.orderNumber).toBe('K9m2X7qL4P');
    expect(receipt.approvalCode).toBe('913180');
    expect(receipt.paidAt).toBe(paidAt);
    expect(receipt.amount).toBe(1000);
    expect(receipt.currencyLabel).toBe('DZD');
    expect(receipt.maskedCard).toBe('6280****7215');
    expect(receipt.cardholderName).toBe('CARDHOLDER NAME');
    expect(receipt.paymentMethod).toBe(SATIM_PAYMENT_METHOD);
    expect(receipt.logo).toBe('/assets/satim.png');
    expect(receipt.supportMessage).toContain('3020');
    expect(receipt.locale()).toBe('fr');
    expect(receipt.direction()).toBe('ltr');
  });

  it('reads right to left in Arabic, with the Arabic hotline text', async () => {
    const { satim } = await harness();

    const receipt = satim.receipt(
      await satim.acknowledge('V721uPPfNNofVQAAABL3'),
      undefined,
      SatimLanguage.AR,
    );

    expect(receipt.direction()).toBe('rtl');
    expect(receipt.locale()).toBe('ar');
    expect(receipt.supportMessage).toContain('3020');
  });

  it('shows an unknown currency exactly as SATIM sent it', async () => {
    const { satim } = await harness({
      acknowledge: SatimFakeResponse.paid(1000, 'K9m2X7qL4P', '913180', '6280****7215', 'ok', {
        currency: '840',
      }),
    });

    const receipt = satim.receipt(await satim.acknowledge('V721uPPfNNofVQAAABL3'));

    expect(receipt.currencyLabel).toBe('840');
  });

  it('refuses to build one for a payment that was not accepted', async () => {
    const { satim } = await harness({ acknowledge: SatimFakeResponse.declined() });

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(() => satim.receipt(result)).toThrow(SatimValidationError);
  });

  it('refuses to build one with no logo configured', async () => {
    const { satim } = await harness({}, {}, ['receiptLogo']);

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(() => satim.receipt(result)).toThrow(SatimConfigurationError);
  });

  it('defaults paidAt to now, so a reprint must pass the stored date back', async () => {
    const { satim } = await harness();

    const receipt = satim.receipt(await satim.acknowledge('V721uPPfNNofVQAAABL3'));

    expect(receipt.paidAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

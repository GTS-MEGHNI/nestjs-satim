import { describe, expect, it } from 'vitest';

import { SatimErrorCode } from '../src/error-code.js';
import { SatimValidationError } from '../src/errors.js';
import { SatimOperation } from '../src/operation.js';
import { SatimOrderStatus } from '../src/order-status.js';
import { SatimFakeResponse } from '../src/testing/fake-response.js';
import { harness } from './helpers.js';

describe('acknowledge', () => {
  it('reads a paid transaction from respCode, errorCode and orderStatus together', async () => {
    const { satim, fake } = await harness();

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(result.paid()).toBe(true);
    expect(result.respCode).toBe('00');
    expect(result.errorCode).toBe('0');
    expect(result.orderStatus).toBe(SatimOrderStatus.Deposited);
    expect(result.status).toBe(SatimOrderStatus.Deposited);
    expect(result.amount).toBe(1000);
    expect(result.amountInCentimes).toBe(100_000);
    expect(result.maskedCard).toBe('6280****7215');
    expect(result.approvalCode).toBe('913180');
    expect(result.error()).toBe(SatimErrorCode.None);

    fake.assertAcknowledged('V721uPPfNNofVQAAABL3');
    expect(fake.recorded(SatimOperation.Acknowledge)[0]?.endpoint).toBe(
      'public/acknowledgeTransaction.do',
    );
  });

  it('sends the order id as mdOrder', async () => {
    const { satim, fake } = await harness();

    await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(fake.recorded(SatimOperation.Acknowledge)[0]?.payload['mdOrder']).toBe(
      'V721uPPfNNofVQAAABL3',
    );
  });

  it('treats a declined payment as rejected and keeps SATIM own wording', async () => {
    const { satim } = await harness({ acknowledge: SatimFakeResponse.declined() });

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(result.paid()).toBe(false);
    expect(result.rejected()).toBe(true);
    expect(result.respCode).toBe('05');
    expect(result.message).toBe('Votre transaction a été rejetée');
    expect(result.status).toBe(SatimOrderStatus.AuthorisationDeclined);
  });

  it('supplies the mandated wording when the authorisation was reversed', async () => {
    const { satim } = await harness({ acknowledge: SatimFakeResponse.reversed() });

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(result.paid()).toBe(false);
    expect(result.cancelled()).toBe(true);
    // The wording follows the language of the call, which defaults to FR here,
    // and replaces SATIM's own text because the gateway reports no error.
    expect(result.message).toBe('Votre transaction a été rejetée');
  });

  it('follows the language of the call for the reversal wording', async () => {
    const { satim } = await harness({ acknowledge: SatimFakeResponse.reversed() });

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3', 'AR');

    expect(result.message).toBe('تم رفض معاملتك');
  });

  it('reports a refund made in the back office', async () => {
    const { satim } = await harness({ acknowledge: SatimFakeResponse.acknowledgeRefunded() });

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(result.refunded()).toBe(true);
    expect(result.paid()).toBe(false);
  });

  it('keeps the raw status when SATIM sends one it does not name', async () => {
    const { satim } = await harness({
      acknowledge: SatimFakeResponse.paid(1000, 'K9m2X7qL4P', '913180', '6280****7215', 'ok', {
        OrderStatus: 99,
      }),
    });

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(result.orderStatus).toBe(99);
    expect(result.status).toBeNull();
  });

  it('falls back to authorizationResponseId when there is no approval code', async () => {
    const { satim } = await harness({
      acknowledge: SatimFakeResponse.make({
        ErrorCode: '0',
        OrderStatus: 2,
        authorizationResponseId: '777777',
        params: { respCode: '00', respCode_desc: 'ok' },
      }),
    });

    const result = await satim.acknowledge('V721uPPfNNofVQAAABL3');

    expect(result.approvalCode).toBe('777777');
  });

  it('refuses an empty order id', async () => {
    const { satim, fake } = await harness();

    await expect(satim.acknowledge('   ')).rejects.toThrow(SatimValidationError);
    fake.assertNothingSent();
  });
});

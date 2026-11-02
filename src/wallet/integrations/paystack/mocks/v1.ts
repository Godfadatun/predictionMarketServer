import { PAYSTACK_STATUS } from '../../../constants/wallet.constants';
import { PaystackInitResult, PaystackVerifyResult } from '../../../interfaces/wallet.interface';

// Paystack contract v1 (transaction/initialize, transaction/verify, charge.success webhook). New version = new file.
export class PaystackMockV1 {
  initializeBody(reference: string) {
    return { status: true, message: 'Authorization URL created', data: { authorization_url: `https://checkout.paystack.com/${reference}`, access_code: `ac_${reference}`, reference } };
  }
  verifyBody(reference: string, amountKobo: number, status: string = PAYSTACK_STATUS.SUCCESS) {
    return { status: true, message: 'Verification successful', data: { reference, amount: amountKobo, currency: 'NGN', status, channel: 'card', paid_at: '2026-11-02T10:00:00.000Z' } };
  }
  serverErrorBody() { return { status: false, message: 'An error occurred' }; }
  malformedBody() { return {}; }
  chargeSuccessEvent(reference: string, amountKobo: number) {
    return { event: 'charge.success', data: { reference, amount: amountKobo, currency: 'NGN', status: PAYSTACK_STATUS.SUCCESS } };
  }

  async initialize(input: { reference: string }): Promise<PaystackInitResult> {
    const body = this.initializeBody(input.reference);
    return { reference: body.data.reference, authorizationUrl: body.data.authorization_url };
  }
  async verify(reference: string, expectedKobo = 0): Promise<PaystackVerifyResult> {
    const body = this.verifyBody(reference, expectedKobo);
    return { reference, status: body.data.status, amountKobo: body.data.amount };
  }
}

export class PaystackMockV1Ongoing extends PaystackMockV1 {
  async verify(reference: string, expectedKobo = 0): Promise<PaystackVerifyResult> {
    return { reference, status: 'ongoing', amountKobo: expectedKobo };
  }
}

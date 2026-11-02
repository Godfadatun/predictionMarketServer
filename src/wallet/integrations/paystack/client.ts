import { connections } from '@/integrations';
import { config } from '@/config';
import { PartnerError } from '@/errors';
import { MESSAGES } from '@/constants/messages';
import { WALLET_CODES } from '../../constants/wallet.constants';
import { PaystackInitResult, PaystackVerifyResult } from '../../interfaces/wallet.interface';

const http = connections.get('paystack');
const unavailable = () => new PartnerError(WALLET_CODES.PARTNER_UNAVAILABLE, MESSAGES.PARTNER_UNAVAILABLE);

interface PaystackEnvelope<T> { status?: boolean; message?: string; data?: T }

export const paystackClient = {
  async initialize(input: { email: string; amountKobo: number; reference: string }): Promise<PaystackInitResult> {
    const res = await http.call<PaystackEnvelope<{ authorization_url?: string }>>({
      event: 'paystack.transaction.initialize', method: 'POST', url: '/transaction/initialize', redact: ['email'],
      data: { email: input.email, amount: input.amountKobo, reference: input.reference, currency: 'NGN', callback_url: config.paystack.callbackUrl },
    }).catch(() => { throw unavailable(); });
    const url = res.body?.data?.authorization_url;
    if (res.status !== 200 || res.body?.status !== true || !url) throw unavailable();
    return { reference: input.reference, authorizationUrl: url };
  },

  async verify(reference: string): Promise<PaystackVerifyResult> {
    const res = await http.call<PaystackEnvelope<{ status?: string; amount?: number }>>({
      event: 'paystack.transaction.verify', method: 'GET', url: `/transaction/verify/${encodeURIComponent(reference)}`,
    }).catch(() => { throw unavailable(); });
    const d = res.body?.data;
    if (res.status !== 200 || typeof d?.status !== 'string' || typeof d?.amount !== 'number') throw unavailable();
    return { reference, status: d.status, amountKobo: d.amount };
  },
};

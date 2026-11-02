import { connections } from '@/integrations';
import { PartnerError, UnprocessableError } from '@/errors';
import { MESSAGES } from '@/constants/messages';
import { PAYOUT_CODES } from '../../constants/payouts.constants';
import { PAYOUT_MESSAGES } from '../../constants/messages';
import { Bank, TransferResult } from '../../interfaces/payouts.interface';

const http = connections.get('paystack');
const unavailable = () => new PartnerError(PAYOUT_CODES.PARTNER_UNAVAILABLE, MESSAGES.PARTNER_UNAVAILABLE);
const ok = (status: number) => status >= 200 && status < 300;
const clientError = (status: number) => status >= 400 && status < 500;

interface Envelope<T> { status?: boolean; message?: string; data?: T }

export const paystackPayoutsClient = {
  async listBanks(): Promise<Bank[]> {
    const res = await http.call<Envelope<Bank[]>>({ event: 'paystack.bank.list', method: 'GET', url: '/bank?country=nigeria&currency=NGN&perPage=200' })
      .catch(() => { throw unavailable(); });
    if (!ok(res.status) || !Array.isArray(res.body?.data)) throw unavailable();
    return res.body.data.map((b) => ({ name: b.name, code: b.code }));
  },

  // 4xx = Paystack could not find the account (user error); timeouts and 5xx = partner unavailable.
  async resolveAccount(accountNumber: string, bankCode: string): Promise<string> {
    const res = await http.call<Envelope<{ account_name?: string }>>({
      event: 'paystack.bank.resolve', method: 'GET', url: `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    }).catch(() => { throw unavailable(); });
    if (clientError(res.status)) throw new UnprocessableError(PAYOUT_CODES.INVALID_BANK_ACCOUNT, PAYOUT_MESSAGES.INVALID_BANK_ACCOUNT);
    const name = res.body?.data?.account_name;
    if (!ok(res.status) || !name) throw unavailable();
    return name;
  },

  async ensureCustomer(input: { email: string; firstName: string; lastName: string; phone: string }): Promise<string> {
    const res = await http.call<Envelope<{ customer_code?: string }>>({
      event: 'paystack.customer.create', method: 'POST', url: '/customer', redact: ['phone'],
      data: { email: input.email, first_name: input.firstName, last_name: input.lastName, phone: input.phone },
    }).catch(() => { throw unavailable(); });
    const code = res.body?.data?.customer_code;
    if (!ok(res.status) || !code) throw unavailable();
    return code;
  },

  async requestIdentification(customerCode: string, input: { accountNumber: string; bankCode: string; bvn: string; firstName: string; lastName: string }) {
    const res = await http.call<Envelope<unknown>>({
      event: 'paystack.customer.identification', method: 'POST', url: `/customer/${encodeURIComponent(customerCode)}/identification`, redact: ['bvn'],
      data: { country: 'NG', type: 'bank_account', account_number: input.accountNumber, bank_code: input.bankCode, bvn: input.bvn, first_name: input.firstName, last_name: input.lastName },
    }).catch(() => { throw unavailable(); });
    if (!ok(res.status) || res.body?.status !== true) throw unavailable();
  },

  async createRecipient(input: { name: string; accountNumber: string; bankCode: string }): Promise<string> {
    const res = await http.call<Envelope<{ recipient_code?: string }>>({
      event: 'paystack.transferrecipient.create', method: 'POST', url: '/transferrecipient',
      data: { type: 'nuban', name: input.name, account_number: input.accountNumber, bank_code: input.bankCode, currency: 'NGN' },
    }).catch(() => { throw unavailable(); });
    const code = res.body?.data?.recipient_code;
    if (!ok(res.status) || !code) throw unavailable();
    return code;
  },

  // A timeout or 5xx is UNKNOWN, not failed: the money may already have moved, so the caller must not refund.
  async transfer(input: { amountKobo: number; recipientCode: string; reference: string; reason: string }): Promise<TransferResult> {
    const res = await http.call<Envelope<{ status?: string; transfer_code?: string }>>({
      event: 'paystack.transfer.create', method: 'POST', url: '/transfer',
      data: { source: 'balance', amount: input.amountKobo, recipient: input.recipientCode, reference: input.reference, reason: input.reason, currency: 'NGN' },
    }).catch(() => null);
    if (!res || res.status >= 500) return { outcome: 'UNKNOWN', status: 'unknown', transferCode: null };
    if (clientError(res.status) || res.body?.status === false) return { outcome: 'REJECTED', status: 'failed', transferCode: null, message: res.body?.message };
    return { outcome: 'ACCEPTED', status: String(res.body?.data?.status ?? 'pending'), transferCode: res.body?.data?.transfer_code ?? null };
  },
};

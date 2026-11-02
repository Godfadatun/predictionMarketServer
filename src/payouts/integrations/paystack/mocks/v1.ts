import { Bank, TransferResult } from '../../../interfaces/payouts.interface';

// Paystack v1 contract: bank/resolve, customer, customer identification (BVN↔account), transferrecipient, transfer + webhooks.
export class PaystackPayoutsMockV1 {
  banksBody() { return { status: true, message: 'Banks retrieved', data: [{ name: 'Access Bank', code: '044' }, { name: 'Guaranty Trust Bank', code: '058' }, { name: 'OPay Digital Services Limited (OPay)', code: '999992' }] }; }
  resolveBody(accountNumber: string, accountName: string) { return { status: true, message: 'Account number resolved', data: { account_number: accountNumber, account_name: accountName, bank_id: 1 } }; }
  resolveNotFoundBody() { return { status: false, message: 'Could not resolve account name. Check parameters or try again.' }; }
  customerBody(customerCode: string, email: string) { return { status: true, message: 'Customer created', data: { customer_code: customerCode, email, id: 1 } }; }
  identificationAcceptedBody() { return { status: true, message: 'Customer Identification in progress' }; }
  identificationSuccessEvent(customerCode: string, email: string, accountNumber: string, bankCode: string) {
    return { event: 'customeridentification.success', data: { customer_id: 1, customer_code: customerCode, email, identification: { country: 'NG', type: 'bank_account', bvn: '200*****677', account_number: accountNumber, bank_code: bankCode } } };
  }
  identificationFailedEvent(customerCode: string, email: string, reason = 'Account number or BVN is incorrect') {
    return { event: 'customeridentification.failed', data: { customer_id: 1, customer_code: customerCode, email, identification: { country: 'NG', type: 'bank_account' }, reason } };
  }
  recipientBody(recipientCode: string) { return { status: true, message: 'Transfer recipient created successfully', data: { recipient_code: recipientCode, active: true, type: 'nuban' } }; }
  transferBody(reference: string, amountKobo: number, status: string) {
    return { status: true, message: 'Transfer has been queued', data: { reference, amount: amountKobo, status, transfer_code: `TRF_${reference.slice(-8)}`, currency: 'NGN' } };
  }
  transferRejectedBody() { return { status: false, message: 'Your balance is not enough to fulfil this request' }; }
  transferEvent(event: string, reference: string, amountKobo: number, status: string) {
    return { event, data: { reference, amount: amountKobo, status, transfer_code: `TRF_${reference.slice(-8)}`, currency: 'NGN' } };
  }
  serverErrorBody() { return { status: false, message: 'An error occurred' }; }

  async listBanks(): Promise<Bank[]> { return this.banksBody().data; }
  async resolveAccount(accountNumber: string): Promise<string> { return this.resolveBody(accountNumber, 'ADA OBI').data.account_name; }
  async ensureCustomer(input: { email: string }): Promise<string> { return this.customerBody('CUS_mock', input.email).data.customer_code; }
  async requestIdentification(): Promise<void> { return undefined; }
  async createRecipient(): Promise<string> { return this.recipientBody('RCP_mock').data.recipient_code; }
  async transfer(input: { reference: string; amountKobo: number }): Promise<TransferResult> {
    const d = this.transferBody(input.reference, input.amountKobo, 'success').data;
    return { status: d.status, transferCode: d.transfer_code };
  }
}

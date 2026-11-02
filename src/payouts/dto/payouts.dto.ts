import Joi from 'joi';
import { WITHDRAWAL_LIMITS_KOBO } from '../constants/payouts.constants';

export const submitAccountSchema = Joi.object({
  bankCode: Joi.string().pattern(/^\d{3,9}$/).required(),
  accountNumber: Joi.string().pattern(/^\d{10}$/).required().messages({ 'string.pattern.base': 'accountNumber must be a 10-digit NUBAN' }),
  bvn: Joi.string().pattern(/^\d{11}$/).required().messages({ 'string.pattern.base': 'bvn must be 11 digits' }),
});
export const withdrawSchema = Joi.object({
  amountKobo: Joi.number().integer().min(WITHDRAWAL_LIMITS_KOBO.MIN).max(WITHDRAWAL_LIMITS_KOBO.MAX).required(),
  idempotencyKey: Joi.string().uuid().required(),
});
export const listWithdrawalsSchema = Joi.object({ limit: Joi.number().integer().min(1).max(100).default(20) });

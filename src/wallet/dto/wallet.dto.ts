import Joi from 'joi';
import { DEPOSIT_LIMITS_KOBO } from '../constants/wallet.constants';

export const depositSchema = Joi.object({
  amountKobo: Joi.number().integer().min(DEPOSIT_LIMITS_KOBO.MIN).max(DEPOSIT_LIMITS_KOBO.MAX).required(),
});
export const referenceParamSchema = Joi.object({ reference: Joi.string().pattern(/^dep_[a-zA-Z0-9]{8,40}$/).required() });
export const ledgerQuerySchema = Joi.object({ limit: Joi.number().integer().min(1).max(100).default(50) });
export const paystackWebhookSchema = Joi.object({
  event: Joi.string().required(),
  data: Joi.object({ reference: Joi.string().required(), amount: Joi.number(), status: Joi.string() }).unknown(true).required(),
}).unknown(true);

import Joi from 'joi';
import { MAX_TRADE_KOBO, MIN_TRADE_KOBO, TRADE_SIDE } from '../constants/trades.constants';

const isBuy = { is: TRADE_SIDE.BUY, then: Joi.required(), otherwise: Joi.forbidden() };
const isSell = { is: TRADE_SIDE.SELL, then: Joi.required(), otherwise: Joi.forbidden() };

export const placeTradeSchema = Joi.object({
  outcomeId: Joi.string().uuid().required(),
  side: Joi.string().valid(...Object.values(TRADE_SIDE)).required(),
  amountKobo: Joi.number().integer().min(MIN_TRADE_KOBO).max(MAX_TRADE_KOBO).when('side', isBuy),
  shares: Joi.number().positive().max(1e7).when('side', isSell),
  minShares: Joi.number().positive().when('side', { is: TRADE_SIDE.BUY, otherwise: Joi.forbidden() }),
  minProceedsKobo: Joi.number().integer().min(0).when('side', { is: TRADE_SIDE.SELL, otherwise: Joi.forbidden() }),
  idempotencyKey: Joi.string().uuid().required(),
});
export const tradeParamSchema = Joi.object({ marketId: Joi.string().uuid().required() });

import Joi from 'joi';
import { DEFAULT_LIQUIDITY_B, MARKET_CATEGORY, MARKET_STATUS, NIGERIAN_STATES } from '../constants/markets.constants';

export const listMarketsSchema = Joi.object({
  category: Joi.string().valid(...Object.values(MARKET_CATEGORY)),
  state: Joi.string().valid(...NIGERIAN_STATES),
  status: Joi.string().valid(...Object.values(MARKET_STATUS)),
  limit: Joi.number().integer().min(1).max(200).default(100),
  offset: Joi.number().integer().min(0).default(0),
});
export const marketParamSchema = Joi.object({ idOrSlug: Joi.string().max(120).required() });
export const createMarketSchema = Joi.object({
  slug: Joi.string().pattern(/^[a-z0-9-]{3,100}$/).required(),
  title: Joi.string().trim().min(5).max(200).required(),
  description: Joi.string().trim().max(5000).required(),
  category: Joi.string().valid(...Object.values(MARKET_CATEGORY)).required(),
  state: Joi.string().valid(...NIGERIAN_STATES).allow(null),
  closesAt: Joi.date().iso().greater('now').required(),
  resolutionSource: Joi.string().trim().max(500).required(),
  resolutionRules: Joi.string().trim().max(5000).required(),
  liquidityB: Joi.number().min(10).max(1_000_000).default(DEFAULT_LIQUIDITY_B),
  outcomes: Joi.array().items(Joi.string().trim().min(1).max(80)).min(2).max(40).unique().required(),
});

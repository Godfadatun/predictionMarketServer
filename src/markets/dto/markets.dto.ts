import Joi from 'joi';
import {
  DEFAULT_LIQUIDITY_B, MARKET_CATEGORY, MARKET_STATUS, MIN_INITIAL_PRICE, NIGERIAN_STATES, PRICE_SUM_TOLERANCE,
} from '../constants/markets.constants';

const FRIDAY = 5;

export const listMarketsSchema = Joi.object({
  category: Joi.string().valid(...Object.values(MARKET_CATEGORY)),
  state: Joi.string().valid(...NIGERIAN_STATES),
  status: Joi.string().valid(...Object.values(MARKET_STATUS)),
  limit: Joi.number().integer().min(1).max(200).default(100),
  offset: Joi.number().integer().min(0).default(0),
});
export const marketParamSchema = Joi.object({ idOrSlug: Joi.string().max(120).required() });
export const marketIdParamSchema = Joi.object({ id: Joi.string().uuid().required() });
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
  initialPrices: Joi.array().items(Joi.number().min(MIN_INITIAL_PRICE).max(1))
    .length(Joi.ref('outcomes', { adjust: (o: unknown[]) => o.length }))
    .custom((v: number[], h) => (Math.abs(v.reduce((s, x) => s + x, 0) - 1) <= PRICE_SUM_TOLERANCE ? v : h.message({ custom: 'initialPrices must add up to 1 (100%)' }))),
});
export const updateMarketSchema = Joi.object({
  title: Joi.string().trim().min(5).max(200),
  description: Joi.string().trim().max(5000),
  resolutionSource: Joi.string().trim().max(500),
  resolutionRules: Joi.string().trim().max(5000),
  closesAt: Joi.date().iso().greater('now'),
}).min(1);
export const closeMarketSchema = Joi.object({});
export const spotifyWeeklySchema = Joi.object({
  weekStart: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
    .custom((v: string, h) => (new Date(`${v}T12:00:00Z`).getUTCDay() === FRIDAY ? v : h.message({ custom: 'weekStart must be a Friday (Spotify chart weeks run Friday–Thursday)' }))),
});

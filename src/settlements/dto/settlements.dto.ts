import Joi from 'joi';

export const proposeSchema = Joi.object({
  outcomeId: Joi.string().uuid(),
  void: Joi.boolean().valid(true),
  sourceUrl: Joi.string().uri({ scheme: ['https', 'http'] }).max(500).required(),
  note: Joi.string().trim().max(1000),
}).xor('outcomeId', 'void');
export const confirmSchema = Joi.object({});
export const settlementParamSchema = Joi.object({ marketId: Joi.string().uuid().required() });
export const resolutionLookupParamSchema = Joi.object({ marketId: Joi.string().max(120).required() });

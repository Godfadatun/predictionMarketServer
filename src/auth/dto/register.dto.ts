import Joi from 'joi';
import { NG_PHONE } from '../constants/auth.constants';

export const registerSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required(),
  phone: Joi.string().trim().pattern(NG_PHONE).required().messages({ 'string.pattern.base': 'phone must be a Nigerian mobile number' }),
  fullName: Joi.string().trim().min(2).max(120).required(),
  password: Joi.string().min(8).max(128).required(),
});

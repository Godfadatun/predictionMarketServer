import { AppError } from '@/errors';

export interface Success<T> { success: true; message: string; data: T; warnings?: string[] }
export interface Failure { success: false; code: string; message: string }

export const SuccessResponse = <T>(data: T, message = 'OK', warnings?: string[]): Success<T> =>
  warnings && warnings.length ? { success: true, message, data, warnings } : { success: true, message, data };

export const errorResponse = (err: AppError): Failure => ({ success: false, code: err.code, message: err.message });

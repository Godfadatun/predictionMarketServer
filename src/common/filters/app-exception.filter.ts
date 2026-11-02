import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError } from '@/errors';
import { errorResponse } from '@/common/responses';
import { ERROR_CODES, MESSAGES } from '@/constants/messages';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('AppExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AppError) {
      res.status(exception.status).json(errorResponse(exception));
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({ success: false, code: `HTTP_${status}`, message: exception.message });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ success: false, code: ERROR_CODES.INTERNAL_ERROR, message: MESSAGES.INTERNAL_ERROR });
  }
}

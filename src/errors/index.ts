export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}
export class ValidationError extends AppError {
  constructor(message: string) { super('VALIDATION_ERROR', message, 400); }
}
export class UnauthorizedError extends AppError {
  constructor(code = 'UNAUTHORIZED', message = 'Authentication required') { super(code, message, 401); }
}
export class ForbiddenError extends AppError {
  constructor(code = 'FORBIDDEN', message = 'You do not have permission to do this') { super(code, message, 403); }
}
export class NotFoundError extends AppError {
  constructor(code: string, message: string) { super(code, message, 404); }
}
export class ConflictError extends AppError {
  constructor(code: string, message: string) { super(code, message, 409); }
}
export class UnprocessableError extends AppError {
  constructor(code: string, message: string) { super(code, message, 422); }
}
export class PartnerError extends AppError {
  constructor(code: string, message: string) { super(code, message, 502); }
}

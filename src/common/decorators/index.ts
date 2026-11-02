import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@/constants/messages';

export interface AuthUser { id: string; role: Role; sessionId: string; email: string }

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);

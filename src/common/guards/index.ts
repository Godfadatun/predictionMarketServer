import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '@/config';
import { ForbiddenError, UnauthorizedError } from '@/errors';
import { ERROR_CODES, MESSAGES, Role } from '@/constants/messages';
import { AuthUser, ROLES_KEY } from '@/common/decorators';

// Bearer JWT carrying a session id; the session must exist, be unrevoked and unexpired, and the user ACTIVE.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly ds: DataSource) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedError();
    let sid: string;
    try {
      sid = (jwt.verify(token, config.jwtSecret) as { sid: string }).sid;
    } catch {
      throw new UnauthorizedError();
    }
    const [row] = await this.ds.query(
      `SELECT s.id AS "sessionId", s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt", u.id, u.role, u.status, u.email, u.full_name AS "fullName", u.phone
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`, [sid]);
    if (!row || row.revokedAt || row.status !== 'ACTIVE') throw new UnauthorizedError();
    if (new Date(row.expiresAt).getTime() <= Date.now()) throw new UnauthorizedError(ERROR_CODES.SESSION_EXPIRED, MESSAGES.SESSION_EXPIRED);
    req.user = { id: row.id, role: row.role, sessionId: row.sessionId, email: row.email, fullName: row.fullName, phone: row.phone } satisfies AuthUser;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenError();
    return true;
  }
}

// Paystack signs webhook bodies with HMAC-SHA512 of the raw body using the secret key.
@Injectable()
export class PaystackSignatureGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const raw: Buffer | undefined = req.rawBody;
    const given = String(req.headers['x-paystack-signature'] ?? '');
    const expected = crypto.createHmac('sha512', config.paystack.secretKey).update(raw ?? Buffer.alloc(0)).digest('hex');
    const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) throw new UnauthorizedError('INVALID_SIGNATURE', 'Webhook signature is invalid');
    return true;
  }
}

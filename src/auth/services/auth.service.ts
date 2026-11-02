import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { EntityManager } from 'typeorm';
import { config } from '@/config';
import { Success, SuccessResponse } from '@/common/responses';
import { UnitOfWork } from '@/common/database/unit-of-work';
import { AuditService } from '@/common/logging/audit.service';
import { AuthUser } from '@/common/decorators';
import { ConflictError, UnauthorizedError } from '@/errors';
import { AuthRepository } from '../repositories/auth.repository';
import { AUTH_CODES, AUTH_EVENTS, BCRYPT_ROUNDS, USER_STATUS } from '../constants/auth.constants';
import { AUTH_MESSAGES } from '../constants/messages';
import { LoginInput, RegisterInput, SessionResult, UserRecord } from '../interfaces/auth.interface';

const normalisePhone = (p: string) => p.replace(/^0/, '+234');

@Injectable()
export class AuthService {
  constructor(private readonly repo: AuthRepository, private readonly uow: UnitOfWork, private readonly audit: AuditService) {}

  async register(input: RegisterInput) {
    const phone = normalisePhone(input.phone);
    if (await this.repo.findUserByEmail(input.email)) throw new ConflictError(AUTH_CODES.EMAIL_TAKEN, AUTH_MESSAGES.EMAIL_TAKEN);
    if (await this.repo.findUserByPhone(phone)) throw new ConflictError(AUTH_CODES.PHONE_TAKEN, AUTH_MESSAGES.PHONE_TAKEN);
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const result = await this.uow.run(async (m) => {
      const user = await this.repo.createUser(m, { email: input.email, phone, fullName: input.fullName, passwordHash });
      await this.audit.record({ event: AUTH_EVENTS.REGISTERED, module: 'auth', tableType: 'users', tableId: user.id, actorId: user.id }, m);
      return this.issueSession(m, user as UserRecord);
    });
    return SuccessResponse(result.data, AUTH_MESSAGES.REGISTERED);
  }

  async login(input: LoginInput) {
    const user = await this.repo.findUserByEmail(input.email);
    const ok = !!user && user.status === USER_STATUS.ACTIVE && (await bcrypt.compare(input.password, user.passwordHash));
    if (!ok) throw new UnauthorizedError(AUTH_CODES.INVALID_CREDENTIALS, AUTH_MESSAGES.INVALID_CREDENTIALS);
    const result = await this.uow.run((m) => this.issueSession(m, user as UserRecord));
    return SuccessResponse(result.data, AUTH_MESSAGES.LOGGED_IN);
  }

  async me(actor: AuthUser) {
    const user = await this.repo.findUserById(actor.id);
    return SuccessResponse(user as UserRecord);
  }

  async logout(actor: AuthUser) {
    await this.repo.revokeSession(actor.sessionId!);
    await this.audit.record({ event: AUTH_EVENTS.LOGGED_OUT, module: 'auth', tableType: 'sessions', tableId: actor.sessionId!, actorId: actor.id, sessionId: actor.sessionId });
    return SuccessResponse({ revoked: true }, AUTH_MESSAGES.LOGGED_OUT);
  }

  private async issueSession(m: EntityManager, user: UserRecord): Promise<Success<SessionResult>> {
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
    const session = await this.repo.createSession(m, user.id, expiresAt);
    const token = jwt.sign({ sid: session.id, sub: user.id }, config.jwtSecret, { expiresIn: `${config.sessionTtlHours}h` });
    return SuccessResponse({ token, expiresAt, user });
  }
}

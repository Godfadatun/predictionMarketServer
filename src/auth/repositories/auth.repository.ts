import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SessionEntity, UserEntity } from './user.entity';

@Injectable()
export class AuthRepository {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(SessionEntity) private readonly sessions: Repository<SessionEntity>,
  ) {}

  findUserByEmail(email: string) { return this.users.findOne({ where: { email } }); }
  findUserByPhone(phone: string) { return this.users.findOne({ where: { phone } }); }
  findUserById(id: string) { return this.users.findOne({ where: { id } }); }
  createUser(m: EntityManager, data: Partial<UserEntity>) { return m.getRepository(UserEntity).save(m.getRepository(UserEntity).create(data)); }
  createSession(m: EntityManager, userId: string, expiresAt: Date) {
    return m.getRepository(SessionEntity).save(m.getRepository(SessionEntity).create({ userId, expiresAt }));
  }
  revokeSession(id: string) { return this.sessions.update({ id }, { revokedAt: new Date() }); }
}

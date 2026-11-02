import { Role } from '@/constants/messages';

export interface RegisterInput { email: string; phone: string; fullName: string; password: string }
export interface LoginInput { email: string; password: string }
export interface UserRecord {
  id: string; email: string; phone: string; fullName: string; passwordHash: string; role: Role; status: string; createdAt: Date;
}
export interface SessionResult { token: string; expiresAt: Date; user: UserRecord }

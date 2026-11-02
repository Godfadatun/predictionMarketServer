import { Success } from '@/common/responses';
import { SessionResult, UserRecord } from '../interfaces/auth.interface';

export const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, phone: u.phone, fullName: u.fullName, role: u.role, createdAt: u.createdAt });

export const sanitizeSession = (r: Success<SessionResult>) => ({
  ...r, data: { token: r.data.token, expiresAt: r.data.expiresAt, user: publicUser(r.data.user) },
});

export const sanitizeUser = (r: Success<UserRecord>) => ({ ...r, data: publicUser(r.data) });

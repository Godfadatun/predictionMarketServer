import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from '@/constants/messages';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column({ unique: true }) phone: string;
  @Column({ name: 'full_name' }) fullName: string;
  @Column({ name: 'password_hash' }) passwordHash: string;
  @Column({ default: 'USER' }) role: Role;
  @Column({ default: 'ACTIVE' }) status: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('sessions')
export class SessionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

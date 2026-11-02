import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { AuthRepository } from './repositories/auth.repository';
import { SessionEntity, UserEntity } from './repositories/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, SessionEntity])],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
})
export class AuthModule {}

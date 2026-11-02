import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '@/config';
import { CommonModule } from '@/common/common.module';
import { AuditLogEntity, ThirdPartyLogEntity } from '@/common/logging/log.entities';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.databaseUrl,
      autoLoadEntities: true,
      entities: [AuditLogEntity, ThirdPartyLogEntity],
      synchronize: config.appEnv !== 'production', // TODO: switch to migrations before production
    }),
    CommonModule,
    AuthModule,
  ],
})
export class AppModule {}

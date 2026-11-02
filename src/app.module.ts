import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { config } from '@/config';
import { CommonModule } from '@/common/common.module';
import { AuditLogEntity, ThirdPartyLogEntity } from '@/common/logging/log.entities';
import { AuthModule } from '@/auth/auth.module';
import { WalletModule } from '@/wallet/wallet.module';
import { MarketsModule } from '@/markets/markets.module';
import { TradesModule } from '@/trades/trades.module';
import { SettlementsModule } from '@/settlements/settlements.module';
import { PayoutsModule } from '@/payouts/payouts.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.databaseUrl,
      autoLoadEntities: true,
      entities: [AuditLogEntity, ThirdPartyLogEntity],
      synchronize: config.appEnv !== 'production', // TODO: switch to migrations before production
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    CommonModule,
    AuthModule,
    WalletModule,
    MarketsModule,
    TradesModule,
    SettlementsModule,
    PayoutsModule,
  ],
})
export class AppModule {}

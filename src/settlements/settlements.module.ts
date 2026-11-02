import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '@/wallet/wallet.module';
import { MarketsModule } from '@/markets/markets.module';
import { TradesModule } from '@/trades/trades.module';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './services/settlements.service';
import { SettlementsRepository } from './repositories/settlements.repository';
import { ResolutionEntity } from './repositories/resolution.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ResolutionEntity]), WalletModule, MarketsModule, TradesModule],
  controllers: [SettlementsController],
  providers: [SettlementsService, SettlementsRepository],
})
export class SettlementsModule {}

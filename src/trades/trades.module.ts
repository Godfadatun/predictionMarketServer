import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '@/wallet/wallet.module';
import { MarketsModule } from '@/markets/markets.module';
import { TradesController } from './trades.controller';
import { TradesService } from './services/trades.service';
import { TradesRepository } from './repositories/trades.repository';
import { PositionEntity, TradeEntity } from './repositories/trade.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TradeEntity, PositionEntity]), WalletModule, MarketsModule],
  controllers: [TradesController],
  providers: [TradesService, TradesRepository],
  exports: [TradesRepository],
})
export class TradesModule {}

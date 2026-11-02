import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '@/wallet/wallet.module';
import { MarketsController } from './markets.controller';
import { MarketsService } from './services/markets.service';
import { MarketsRepository } from './repositories/markets.repository';
import { SpotifyWeeklyCron } from './services/spotify-weekly.cron';
import { MarketEntity, OutcomeEntity } from './repositories/market.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MarketEntity, OutcomeEntity]), WalletModule],
  controllers: [MarketsController],
  providers: [MarketsService, MarketsRepository, SpotifyWeeklyCron],
  exports: [MarketsRepository],
})
export class MarketsModule {}

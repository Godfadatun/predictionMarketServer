import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '@/wallet/wallet.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './services/payouts.service';
import { PayoutsRepository } from './repositories/payouts.repository';
import { PayoutAccountEntity, WithdrawalEntity } from './repositories/payouts.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PayoutAccountEntity, WithdrawalEntity]), WalletModule],
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
})
export class PayoutsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletController } from './wallet.controller';
import { WalletService } from './services/wallet.service';
import { LedgerService } from './services/ledger.service';
import { LedgerRepository } from './repositories/ledger.repository';
import { DepositsRepository } from './repositories/deposits.repository';
import { AccountEntity, DepositEntity, LedgerEntryEntity } from './repositories/wallet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AccountEntity, LedgerEntryEntity, DepositEntity])],
  controllers: [WalletController],
  providers: [WalletService, LedgerService, LedgerRepository, DepositsRepository],
  exports: [LedgerService],
})
export class WalletModule {}

import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard, PaystackSignatureGuard } from '@/common/guards';
import { JoiValidationPipe } from '@/common/pipes/joi-validation.pipe';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { depositSchema, ledgerQuerySchema, paystackWebhookSchema, referenceParamSchema } from './dto/wallet.dto';
import { WalletService } from './services/wallet.service';
import { sanitizeDeposit, sanitizeLedger } from './sanitizers/wallet.sanitizer';
import { DepositInitInput, PaystackWebhookEvent } from './interfaces/wallet.interface';

@Controller('wallet')
export class WalletController {
  constructor(private readonly service: WalletService) {}

  @Get()
  @UseGuards(AuthGuard)
  getWallet(@CurrentUser() user: AuthUser) {
    return this.service.getWallet(user);
  }

  @Get('ledger')
  @UseGuards(AuthGuard)
  @UsePipes(new JoiValidationPipe(ledgerQuerySchema, 'query'))
  async ledger(@CurrentUser() user: AuthUser, @Query() q: { limit: number }) {
    return sanitizeLedger(await this.service.ledgerEntries(user, q.limit));
  }

  @Post('deposits')
  @UseGuards(AuthGuard)
  @UsePipes(new JoiValidationPipe(depositSchema))
  async deposit(@CurrentUser() user: AuthUser, @Body() body: DepositInitInput) {
    return sanitizeDeposit(await this.service.initDeposit(user, body));
  }

  @Post('deposits/:reference/verify')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @UsePipes(new JoiValidationPipe(referenceParamSchema, 'param'))
  verify(@CurrentUser() user: AuthUser, @Param() p: { reference: string }) {
    return this.service.verifyDeposit(user, p.reference);
  }

  @Post('webhooks/paystack')
  @HttpCode(200)
  @UseGuards(PaystackSignatureGuard)
  @UsePipes(new JoiValidationPipe(paystackWebhookSchema))
  webhook(@Body() body: PaystackWebhookEvent) {
    return this.service.handlePaystackEvent(body);
  }
}

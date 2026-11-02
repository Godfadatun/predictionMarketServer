import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@/common/guards';
import { JoiValidationPipe } from '@/common/pipes/joi-validation.pipe';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { listWithdrawalsSchema, submitAccountSchema, withdrawSchema } from './dto/payouts.dto';
import { PayoutsService } from './services/payouts.service';
import { sanitizeAccount, sanitizeWithdrawals, withdrawalStatus } from './sanitizers/payouts.sanitizer';
import { SubmitAccountInput, WithdrawInput } from './interfaces/payouts.interface';

@Controller('payouts')
@UseGuards(AuthGuard)
export class PayoutsController {
  constructor(private readonly service: PayoutsService) {}

  @Get('banks')
  banks() {
    return this.service.banks();
  }

  @Get('account')
  async account(@CurrentUser() user: AuthUser) {
    return sanitizeAccount(await this.service.getAccount(user));
  }

  @Post('account')
  @HttpCode(202)
  @UsePipes(new JoiValidationPipe(submitAccountSchema))
  async submitAccount(@CurrentUser() user: AuthUser, @Body() body: SubmitAccountInput) {
    return sanitizeAccount(await this.service.submitAccount(user, body));
  }

  @Get('withdrawals')
  @UsePipes(new JoiValidationPipe(listWithdrawalsSchema, 'query'))
  async withdrawals(@CurrentUser() user: AuthUser, @Query() q: { limit: number }) {
    return sanitizeWithdrawals(await this.service.listWithdrawals(user, q.limit));
  }

  @Post('withdrawals')
  @UsePipes(new JoiValidationPipe(withdrawSchema))
  async withdraw(@CurrentUser() user: AuthUser, @Body() body: WithdrawInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.withdraw(user, body);
    res.status(withdrawalStatus(result));
    return result;
  }
}

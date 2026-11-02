import { Body, Controller, Get, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@/common/guards';
import { JoiValidationPipe } from '@/common/pipes/joi-validation.pipe';
import { AuthUser, CurrentUser } from '@/common/decorators';
import { placeTradeSchema, tradeParamSchema } from './dto/trades.dto';
import { TradesService } from './services/trades.service';
import { sanitizePositions } from './sanitizers/trades.sanitizer';
import { PlaceTradeInput } from './interfaces/trades.interface';

@Controller()
@UseGuards(AuthGuard)
export class TradesController {
  constructor(private readonly service: TradesService) {}

  @Post('markets/:marketId/trades')
  @UsePipes(new JoiValidationPipe(placeTradeSchema), new JoiValidationPipe(tradeParamSchema, 'param'))
  place(@CurrentUser() user: AuthUser, @Param() p: { marketId: string }, @Body() body: PlaceTradeInput) {
    return this.service.place(user, p.marketId, body);
  }

  @Get('positions')
  async positions(@CurrentUser() user: AuthUser) {
    return sanitizePositions(await this.service.positions(user));
  }
}

import { Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard, RolesGuard } from '@/common/guards';
import { JoiValidationPipe } from '@/common/pipes/joi-validation.pipe';
import { AuthUser, CurrentUser, Roles } from '@/common/decorators';
import { ROLES } from '@/constants/messages';
import { createMarketSchema, listMarketsSchema, marketParamSchema } from './dto/markets.dto';
import { MarketsService } from './services/markets.service';
import { sanitizeMarket, sanitizeMarkets } from './sanitizers/markets.sanitizer';
import { CreateMarketInput, MarketFilters } from './interfaces/markets.interface';

@Controller('markets')
export class MarketsController {
  constructor(private readonly service: MarketsService) {}

  @Get()
  @UsePipes(new JoiValidationPipe(listMarketsSchema, 'query'))
  async list(@Query() q: MarketFilters) {
    return sanitizeMarkets(await this.service.list(q));
  }

  @Get(':idOrSlug')
  @UsePipes(new JoiValidationPipe(marketParamSchema, 'param'))
  async get(@Param() p: { idOrSlug: string }) {
    return sanitizeMarket(await this.service.get(p.idOrSlug));
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @UsePipes(new JoiValidationPipe(createMarketSchema))
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateMarketInput) {
    return sanitizeMarket(await this.service.create(user, body));
  }
}

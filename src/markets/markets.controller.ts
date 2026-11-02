import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard, RolesGuard } from '@/common/guards';
import { JoiValidationPipe } from '@/common/pipes/joi-validation.pipe';
import { AuthUser, CurrentUser, Roles } from '@/common/decorators';
import { ROLES } from '@/constants/messages';
import {
  closeMarketSchema, createMarketSchema, listMarketsSchema, marketIdParamSchema, marketParamSchema, spotifyWeeklySchema, updateMarketSchema,
} from './dto/markets.dto';
import { MarketsService } from './services/markets.service';
import { sanitizeMarket, sanitizeMarkets, templateStatus } from './sanitizers/markets.sanitizer';
import { CreateMarketInput, MarketFilters, UpdateMarketInput } from './interfaces/markets.interface';

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

  @Post('templates/spotify-weekly')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @UsePipes(new JoiValidationPipe(spotifyWeeklySchema))
  async spotifyWeekly(@CurrentUser() user: AuthUser, @Body() body: { weekStart: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.spotifyWeekly(user, body.weekStart);
    res.status(templateStatus(result));
    return sanitizeMarket(result);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @UsePipes(new JoiValidationPipe(updateMarketSchema), new JoiValidationPipe(marketIdParamSchema, 'param'))
  async update(@CurrentUser() user: AuthUser, @Param() p: { id: string }, @Body() body: UpdateMarketInput) {
    return sanitizeMarket(await this.service.update(user, p.id, body));
  }

  @Post(':id/close')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @UsePipes(new JoiValidationPipe(closeMarketSchema), new JoiValidationPipe(marketIdParamSchema, 'param'))
  async close(@CurrentUser() user: AuthUser, @Param() p: { id: string }) {
    return sanitizeMarket(await this.service.close(user, p.id));
  }
}

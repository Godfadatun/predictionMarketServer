import { Body, Controller, Get, HttpCode, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard, RolesGuard } from '@/common/guards';
import { JoiValidationPipe } from '@/common/pipes/joi-validation.pipe';
import { AuthUser, CurrentUser, Roles } from '@/common/decorators';
import { ROLES } from '@/constants/messages';
import { confirmSchema, proposeSchema, resolutionLookupParamSchema, settlementParamSchema } from './dto/settlements.dto';
import { SettlementsService } from './services/settlements.service';
import { sanitizeResolution } from './sanitizers/settlements.sanitizer';
import { ProposeInput } from './interfaces/settlements.interface';

@Controller('markets/:marketId/resolution')
export class SettlementsController {
  constructor(private readonly service: SettlementsService) {}

  @Get()
  @UsePipes(new JoiValidationPipe(resolutionLookupParamSchema, 'param'))
  async get(@Param() p: { marketId: string }) {
    return sanitizeResolution(await this.service.get(p.marketId));
  }

  @Post('propose')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @UsePipes(new JoiValidationPipe(proposeSchema), new JoiValidationPipe(settlementParamSchema, 'param'))
  async propose(@CurrentUser() user: AuthUser, @Param() p: { marketId: string }, @Body() body: ProposeInput) {
    return sanitizeResolution(await this.service.propose(user, p.marketId, body));
  }

  @Post('confirm')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @UsePipes(new JoiValidationPipe(confirmSchema), new JoiValidationPipe(settlementParamSchema, 'param'))
  async confirm(@CurrentUser() user: AuthUser, @Param() p: { marketId: string }) {
    return sanitizeResolution(await this.service.confirm(user, p.marketId));
  }
}

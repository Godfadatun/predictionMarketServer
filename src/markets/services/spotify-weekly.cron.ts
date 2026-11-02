import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SuccessResponse } from '@/common/responses';
import { SPOTIFY_WEEKLY } from '../constants/markets.constants';
import { MarketsService } from './markets.service';

const DAY_MS = 86_400_000;
const FRIDAY = 5;

// Every Wednesday, open the market for the chart week that starts on the coming Friday.
@Injectable()
export class SpotifyWeeklyCron {
  private readonly logger = new Logger('SpotifyWeeklyCron');
  constructor(private readonly markets: MarketsService) {}

  @Cron(SPOTIFY_WEEKLY.CRON, { timeZone: 'UTC' })
  async run() {
    const now = new Date();
    const friday = new Date(now.getTime() + (((FRIDAY - now.getUTCDay() + 7) % 7) || 7) * DAY_MS).toISOString().slice(0, 10);
    const res = await this.markets.spotifyWeekly(null, friday).catch((e) => SuccessResponse(null, String(e)));
    this.logger.log(`spotify weekly ${friday}: ${res.message}`);
    return SuccessResponse(res.data);
  }
}

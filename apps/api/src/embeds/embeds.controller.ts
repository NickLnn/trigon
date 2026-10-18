import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators';
import { EmbedsService } from './embeds.service';

@Controller('embeds')
export class EmbedsController {
  constructor(private readonly embeds: EmbedsService) {}

  /** The server fetches the URL, so only people who can add embeds (editors) may ask it to. */
  @Get('unfurl')
  @Roles('admin', 'editor')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  unfurl(@Query('url') url: string) {
    return this.embeds.unfurl(url);
  }
}

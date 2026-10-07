import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EmbedsService } from './embeds.service';

@Controller('embeds')
export class EmbedsController {
  constructor(private readonly embeds: EmbedsService) {}

  @Get('unfurl')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  unfurl(@Query('url') url: string) {
    return this.embeds.unfurl(url);
  }
}

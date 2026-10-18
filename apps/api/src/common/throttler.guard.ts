import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIp } from '../activity/request-context';

/**
 * Rate limits per visitor rather than per hop: requests reach the API through the web container's proxy
 * and the Next.js rewrite, so `req.ip` is a proxy address shared by everyone. The proxy stamps the real
 * client address (X-Trigon-Client-IP), which is what the audit log uses too.
 */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    return clientIp(req.headers ?? {}, req.socket?.remoteAddress) ?? req.ip ?? 'unknown';
  }
}

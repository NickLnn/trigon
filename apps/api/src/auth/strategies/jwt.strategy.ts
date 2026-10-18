import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ACCESS_COOKIE } from '@trigon/shared';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../../common/decorators';
import type { AccessPayload } from '../tokens.service';
import { UserStatusService } from '../user-status.service';

/** Reads the access token from the httpOnly cookie, falling back to a Bearer header for API clients. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly statuses: UserStatusService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.[ACCESS_COOKIE] ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  /**
   * A valid signature isn't enough: the account must still be active, and the role comes from the
   * database, not the token — so deactivation and demotion apply at once, not when the token expires.
   */
  async validate(payload: AccessPayload): Promise<AuthUser> {
    if (payload.typ !== 'access' || !payload.sub) throw new UnauthorizedException();
    const status = await this.statuses.get(payload.sub);
    if (!status?.active) throw new UnauthorizedException('Account disabled');
    return { id: payload.sub, email: payload.email, role: status.role };
  }
}

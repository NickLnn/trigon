import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { hash } from '@node-rs/argon2';
import { REFRESH_COOKIE, type AuthConfig, type SessionUser } from '@trigon/shared';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../common/decorators';
import { LdapService } from '../directory/ldap.service';
import { SettingsService } from '../settings/settings.service';
import { IdentityService } from '../users/identity.service';
import { EntraAuthService, type EntraLoginState } from './entra-auth.service';
import { TokensService } from './tokens.service';

const OIDC_COOKIE = 'trigon_oidc';

class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password: string;
}

/** Only allow same-app relative paths as post-login redirects. */
const safeReturnTo = (v: unknown) => (typeof v === 'string' && /^\/(?!\/)/.test(v) ? v : '/');

@Controller('auth')
export class AuthController {
  constructor(
    private readonly tokens: TokensService,
    private readonly identity: IdentityService,
    private readonly entra: EntraAuthService,
    private readonly ldap: LdapService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly settings: SettingsService,
  ) {}

  private async signupAllowed() {
    return (await this.settings.get('general')).allowLocalSignup;
  }

  @Public()
  @Get('config')
  async authConfig(): Promise<AuthConfig> {
    return {
      local: { enabled: true, signup: await this.signupAllowed() },
      entra: { enabled: await this.entra.enabled() },
      ldap: { enabled: await this.ldap.enabled() },
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!(await this.signupAllowed())) throw new ForbiddenException('Self-registration is disabled');
    if (await this.identity.findUserByEmail(dto.email)) throw new ConflictException('An account with this email already exists');
    const user = await this.identity.createLocal(dto.email.trim(), dto.displayName.trim(), await hash(dto.password));
    await this.tokens.issueSession(res, user, req.headers['user-agent']);
    return this.identity.toSessionUser(user.id);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(200)
  async login(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.finishLogin(user, req, res);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('ldap'))
  @Post('ldap')
  @HttpCode(200)
  async ldapLogin(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.finishLogin(user, req, res);
  }

  private async finishLogin(user: AuthUser, req: Request, res: Response): Promise<SessionUser | null> {
    await this.tokens.issueSession(res, user, req.headers['user-agent']);
    await this.identity.touchLogin(user.id);
    return this.identity.toSessionUser(user.id);
  }

  /** Step 1 of Microsoft sign-in: redirect to the Entra authorize endpoint. */
  @Public()
  @Get('entra/login')
  async entraLogin(@Query('returnTo') returnTo: string, @Res() res: Response) {
    const { url, login } = await this.entra.begin(safeReturnTo(returnTo));
    res.cookie(OIDC_COOKIE, await this.jwt.signAsync(login, { expiresIn: '10m' }), {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60_000,
    });
    res.redirect(url);
  }

  /** Step 2: Entra redirects back with ?code&state. */
  @Public()
  @Get('entra/callback')
  async entraCallback(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const appUrl = this.config.getOrThrow<string>('APP_URL');
    if (q.error) return res.redirect(`${appUrl}/login?error=${encodeURIComponent(q.error_description ?? q.error)}`);

    let login: EntraLoginState | undefined;
    try {
      login = await this.jwt.verifyAsync<EntraLoginState>(req.cookies?.[OIDC_COOKIE] ?? '');
    } catch {
      login = undefined;
    }
    res.clearCookie(OIDC_COOKIE, { path: '/' });

    try {
      const user = await this.entra.complete(q.code, q.state, login);
      if (!user.active) throw new UnauthorizedException('Account disabled');
      await this.tokens.issueSession(res, user, req.headers['user-agent']);
      await this.identity.touchLogin(user.id);
      res.redirect(`${appUrl}${safeReturnTo(login?.returnTo)}`);
    } catch (err) {
      res.redirect(`${appUrl}/login?error=${encodeURIComponent((err as Error).message)}`);
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.tokens.rotate(res, req.cookies?.[REFRESH_COOKIE], req.headers['user-agent']);
    return this.identity.toSessionUser(user.id);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.tokens.logout(res, req.cookies?.[REFRESH_COOKIE]);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const session = await this.identity.toSessionUser(user.id);
    if (!session) throw new UnauthorizedException();
    return session;
  }

  /** Short-lived token for the Yjs collaboration WebSocket. */
  @Get('collab-token')
  async collabToken(@CurrentUser() user: AuthUser) {
    return { token: await this.tokens.signCollab(user) };
  }
}

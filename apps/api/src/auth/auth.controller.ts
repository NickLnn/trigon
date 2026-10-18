import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Logger,
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
import { ActivityService } from '../activity/activity.service';
import { CurrentUser, Public, type AuthUser } from '../common/decorators';
import { EntraRedirectService, redirectAllowed } from '../directory/entra-redirect.service';
import { LdapService } from '../directory/ldap.service';
import { SettingsService } from '../settings/settings.service';
import { IdentityLinkRefused, IdentityService } from '../users/identity.service';
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
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly tokens: TokensService,
    private readonly identity: IdentityService,
    private readonly entra: EntraAuthService,
    private readonly ldap: LdapService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly settings: SettingsService,
    private readonly redirects: EntraRedirectService,
    private readonly activity: ActivityService,
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
    this.activity.record({ action: 'user.created', actorId: user.id, target: { type: 'user', id: user.id, name: user.displayName }, details: { selfRegistered: true } });
    await this.tokens.issueSession(res, user, req.headers['user-agent']);
    return this.identity.toSessionUser(user.id);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(200)
  async login(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.finishLogin(user, req, res, 'Email and password');
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('ldap'))
  @Post('ldap')
  @HttpCode(200)
  async ldapLogin(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.finishLogin(user, req, res, 'Domain (LDAP)');
  }

  private async finishLogin(user: AuthUser, req: Request, res: Response, method: string): Promise<SessionUser | null> {
    await this.tokens.issueSession(res, user, req.headers['user-agent']);
    await this.identity.touchLogin(user.id);
    this.activity.record({ action: 'user.signed_in', actorId: user.id, details: { method } });
    return this.identity.toSessionUser(user.id);
  }

  /** Step 1 of Microsoft sign-in: redirect to the Entra authorize endpoint. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('entra/login')
  async entraLogin(@Query('returnTo') returnTo: string, @Req() req: Request, @Res() res: Response) {
    const { redirectUri, origin } = await this.redirects.forRequest(req);
    if (!redirectAllowed(redirectUri)) {
      const message = 'Sign in with Microsoft needs Trigon to be opened over HTTPS. Ask an administrator to open Trigon at its https:// address once.';
      return res.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
    }
    // Registers the address with Microsoft if it is new (cached once it has been verified).
    await this.redirects.ensure();
    const { url, login } = await this.entra.begin(safeReturnTo(returnTo), redirectUri, origin);
    res.cookie(OIDC_COOKIE, await this.jwt.signAsync(login, { expiresIn: '10m' }), {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true' || origin.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60_000,
    });
    res.redirect(url);
  }

  /** Step 2: Entra redirects back with ?code&state. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('entra/callback')
  async entraCallback(@Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    let login: EntraLoginState | undefined;
    try {
      login = await this.jwt.verifyAsync<EntraLoginState>(req.cookies?.[OIDC_COOKIE] ?? '');
      if (login?.typ !== 'oidc') login = undefined;
    } catch {
      login = undefined;
    }
    res.clearCookie(OIDC_COOKIE, { path: '/' });
    // The signed state names the (trusted) address the sign-in started from.
    const base = login?.origin ?? new URL(await this.settings.publicUrl()).origin;
    if (q.error) {
      this.logger.warn(`Microsoft sign-in returned ${q.error}: ${String(q.error_description ?? '').slice(0, 500)}`);
      const shown = q.error === 'access_denied' ? 'Sign in with Microsoft was cancelled or not allowed.' : 'Microsoft could not sign you in. Try again, or ask an administrator.';
      return res.redirect(`${base}/login?error=${encodeURIComponent(shown)}`);
    }

    try {
      // Signed in already (e.g. with a password)? Then this Microsoft account may be linked to that account.
      const user = await this.entra.complete(q.code, q.state, login, await this.tokens.sessionUserId(req));
      if (!user.active) throw new UnauthorizedException('Account disabled');
      await this.tokens.issueSession(res, user, req.headers['user-agent']);
      await this.identity.touchLogin(user.id);
      this.activity.record({ action: 'user.signed_in', actorId: user.id, details: { method: 'Microsoft' } });
      res.redirect(`${base}${safeReturnTo(login?.returnTo)}`);
    } catch (err) {
      const reason = (err as Error).message;
      this.activity.record({ action: 'user.sign_in_failed', actorId: null, actorName: 'Microsoft sign-in', details: { method: 'Microsoft', reason: reason.slice(0, 500) } });
      // Our own messages are meant for people; library and network errors stay in the log.
      const shown = err instanceof HttpException || err instanceof IdentityLinkRefused ? reason : 'Sign in with Microsoft failed. Try again, or ask an administrator.';
      if (shown !== reason) this.logger.warn(`Microsoft sign-in failed: ${reason}`);
      res.redirect(`${base}/login?error=${encodeURIComponent(shown)}`);
    }
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.tokens.rotate(res, req.cookies?.[REFRESH_COOKIE], req.headers['user-agent']);
    return this.identity.toSessionUser(user.id);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.tokens.logout(res, req.cookies?.[REFRESH_COOKIE]);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @Req() req: Request) {
    // An admin's browser tells us the real public (HTTPS) address — Microsoft sign-in is enabled there.
    if (user.role === 'admin') this.redirects.learnFromAdmin(req, user.id).catch(() => undefined);
    const session = await this.identity.toSessionUser(user.id);
    if (!session) throw new UnauthorizedException();
    return session;
  }

  /** Short-lived token for the Yjs collaboration WebSocket. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('collab-token')
  async collabToken(@CurrentUser() user: AuthUser) {
    return { token: await this.tokens.signCollab(user) };
  }
}

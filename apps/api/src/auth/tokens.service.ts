import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_COOKIE, REFRESH_COOKIE, type SystemRole } from '@trigon/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { CookieOptions, Request, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ActivityService } from '../activity/activity.service';
import { Database, InjectDb } from '../db/db.module';
import { refreshTokens, users } from '../db/schema';
import { requestOrigin } from '../directory/entra-redirect.service';

export interface AccessPayload {
  sub: string;
  email: string;
  role: SystemRole;
  typ: 'access' | 'collab';
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Short-lived JWT access tokens + opaque rotating refresh tokens.
 * Both travel only in httpOnly cookies, so page scripts never see them.
 */
@Injectable()
export class TokensService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * httpOnly, SameSite=Lax, and Secure whenever the browser reached Trigon over HTTPS (seen through the
   * proxy headers) or COOKIE_SECURE=true — so a session cookie set on the HTTPS address is never sent
   * over plain HTTP, while LAN access over http:// keeps working.
   */
  private cookieBase(res: Response): CookieOptions {
    const https = !!res.req && requestOrigin(res.req)?.startsWith('https://');
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true' || https,
      sameSite: 'lax',
      domain: this.config.get('COOKIE_DOMAIN') || undefined,
    };
  }

  private get refreshDays() {
    return Number(this.config.get('JWT_REFRESH_TTL_DAYS') ?? 30);
  }

  signAccess(user: { id: string; email: string; role: SystemRole }) {
    const payload: AccessPayload = { sub: user.id, email: user.email, role: user.role, typ: 'access' };
    return this.jwt.signAsync(payload);
  }

  /** Short-lived token handed to the browser for authenticating the collaboration WebSocket. */
  signCollab(user: { id: string; email: string; role: SystemRole }) {
    const payload: AccessPayload = { sub: user.id, email: user.email, role: user.role, typ: 'collab' };
    return this.jwt.signAsync(payload, { expiresIn: '10m' });
  }

  verify(token: string): Promise<AccessPayload> {
    return this.jwt.verifyAsync<AccessPayload>(token);
  }

  /** Id of the user signed in on this browser (valid access cookie), or null. */
  async sessionUserId(req: Request): Promise<string | null> {
    const raw = req.cookies?.[ACCESS_COOKIE];
    if (!raw) return null;
    const payload = await this.verify(raw).catch(() => null);
    return payload?.typ === 'access' ? payload.sub : null;
  }

  async issueSession(res: Response, user: { id: string; email: string; role: SystemRole }, userAgent?: string) {
    await this.writeRefresh(res, user.id, randomUUID(), userAgent);
    res.cookie(ACCESS_COOKIE, await this.signAccess(user), { ...this.cookieBase(res), path: '/', maxAge: 15 * 60_000 });
  }

  private async writeRefresh(res: Response, userId: string, familyId: string, userAgent?: string) {
    const raw = randomBytes(48).toString('base64url');
    await this.db.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: sha256(raw),
      userAgent: userAgent?.slice(0, 255),
      expiresAt: new Date(Date.now() + this.refreshDays * 86_400_000),
    });
    res.cookie(REFRESH_COOKIE, raw, { ...this.cookieBase(res), path: '/', maxAge: this.refreshDays * 86_400_000 });
  }

  /** Rotate a refresh token. Presenting an already-revoked token revokes its whole family. */
  async rotate(res: Response, raw: string | undefined, userAgent?: string) {
    if (!raw) throw new UnauthorizedException();
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).limit(1);
    if (!row || row.expiresAt < new Date()) throw new UnauthorizedException();
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      // A revoked token came back: either a stolen copy or a replayed request. Worth an investigation.
      this.activity.record({ action: 'user.token_reuse', actorId: row.userId, details: { session: row.familyId, userAgent: row.userAgent } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user?.active) throw new UnauthorizedException();

    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    await this.writeRefresh(res, user.id, row.familyId, userAgent);
    res.cookie(ACCESS_COOKIE, await this.signAccess(user), { ...this.cookieBase(res), path: '/', maxAge: 15 * 60_000 });
    return user;
  }

  async revokeFamily(familyId: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async logout(res: Response, raw: string | undefined) {
    if (raw) {
      const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).limit(1);
      if (row) {
        await this.revokeFamily(row.familyId);
        this.activity.record({ action: 'user.signed_out', actorId: row.userId });
      }
    }
    res.clearCookie(ACCESS_COOKIE, { ...this.cookieBase(res), path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieBase(res), path: '/' });
  }
}

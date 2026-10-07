import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_COOKIE, REFRESH_COOKIE, type SystemRole } from '@trigon/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { CookieOptions, Response } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Database, InjectDb } from '../db/db.module';
import { refreshTokens, users } from '../db/schema';

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
  ) {}

  private cookieBase(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') === 'true',
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

  async issueSession(res: Response, user: { id: string; email: string; role: SystemRole }, userAgent?: string) {
    await this.writeRefresh(res, user.id, randomUUID(), userAgent);
    res.cookie(ACCESS_COOKIE, await this.signAccess(user), { ...this.cookieBase(), path: '/', maxAge: 15 * 60_000 });
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
    res.cookie(REFRESH_COOKIE, raw, { ...this.cookieBase(), path: '/', maxAge: this.refreshDays * 86_400_000 });
  }

  /** Rotate a refresh token. Presenting an already-revoked token revokes its whole family. */
  async rotate(res: Response, raw: string | undefined, userAgent?: string) {
    if (!raw) throw new UnauthorizedException();
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(raw))).limit(1);
    if (!row || row.expiresAt < new Date()) throw new UnauthorizedException();
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user?.active) throw new UnauthorizedException();

    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    await this.writeRefresh(res, user.id, row.familyId, userAgent);
    res.cookie(ACCESS_COOKIE, await this.signAccess(user), { ...this.cookieBase(), path: '/', maxAge: 15 * 60_000 });
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
      if (row) await this.revokeFamily(row.familyId);
    }
    res.clearCookie(ACCESS_COOKIE, { ...this.cookieBase(), path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieBase(), path: '/' });
  }
}

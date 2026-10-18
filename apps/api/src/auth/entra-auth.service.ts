import { BadRequestException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { EntraClientService } from '../directory/entra-client.service';
import { SettingsService } from '../settings/settings.service';
import { IdentityService } from '../users/identity.service';

const SCOPES = ['openid', 'profile', 'email', 'User.Read'];

/** Authorities that accept accounts from any tenant (or personal accounts) — never valid for Trigon. */
const MULTI_TENANT = new Set(['common', 'organizations', 'consumers']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tenant id Trigon accepts: the directory's GUID or one of its verified domain names. */
export function validTenantId(tenantId: string): boolean {
  const t = tenantId.trim().toLowerCase();
  return !MULTI_TENANT.has(t) && (GUID.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t));
}

/** Constant-time comparison of the OIDC state values. */
export function sameState(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The token was issued by the configured tenant (checked against the GUID when one is configured). */
export function tenantMatches(configured: string, tid: unknown): boolean {
  if (!validTenantId(configured)) return false;
  return GUID.test(configured.trim()) ? String(tid ?? '').toLowerCase() === configured.trim().toLowerCase() : typeof tid === 'string' && GUID.test(tid);
}

export interface EntraLoginState {
  /** Marks the signed cookie as a sign-in state (not any other token signed with the same key). */
  typ: 'oidc';
  state: string;
  verifier: string;
  returnTo: string;
  /** Redirect URI sent to Microsoft; the token request must repeat it exactly. */
  redirectUri: string;
  /** Address the browser started from — where it goes back to afterwards. */
  origin: string;
}

/** OIDC authorization-code + PKCE sign-in with Microsoft Entra ID, via MSAL. */
@Injectable()
export class EntraAuthService {
  constructor(
    private readonly entra: EntraClientService,
    private readonly identity: IdentityService,
    private readonly settings: SettingsService,
  ) {}

  enabled() {
    return this.entra.enabled();
  }

  async begin(returnTo: string, redirectUri: string, origin: string): Promise<{ url: string; login: EntraLoginState }> {
    const { verifier, challenge } = await this.entra.crypto.generatePkceCodes();
    const state = this.entra.crypto.createNewGuid();
    const url = await (await this.entra.client()).getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      prompt: 'select_account',
    });
    return { url, login: { typ: 'oidc', state, verifier, returnTo, redirectUri, origin } };
  }

  async complete(code: string, state: string, login: EntraLoginState | undefined, linkUserId: string | null = null) {
    if (!login || login.typ !== 'oidc' || !sameState(login.state, state)) throw new BadRequestException('Invalid or expired sign-in state');
    if (typeof code !== 'string' || !code) throw new BadRequestException('Microsoft did not return a sign-in code');
    const { tenantId } = await this.settings.get('entra');
    if (!validTenantId(tenantId)) throw new BadRequestException('Microsoft sign-in is misconfigured: set the tenant ID of your directory (not "common").');
    const result = await (await this.entra.client()).acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: login.redirectUri,
      codeVerifier: login.verifier,
    });
    const claims = result.idTokenClaims as Record<string, unknown>;
    // Only people from the configured directory (the authority already restricts this; checked again).
    if (!tenantMatches(tenantId, claims.tid)) throw new BadRequestException('This Microsoft account belongs to another organisation.');
    const oid = String(claims.oid ?? result.uniqueId);
    const email = String(claims.email ?? claims.preferred_username ?? result.account?.username ?? '');
    if (!oid || !email) throw new BadRequestException('Entra token is missing oid/email claims');

    // With a sync scope, only people the admin chose (and who have been synced) may sign in.
    if ((await this.settings.get('entra')).syncScope === 'selected') {
      const account = await this.identity.findAccount('entra', oid);
      const session = account ? await this.identity.toSessionUser(account.userId) : null;
      if (!session) throw new BadRequestException("Your Microsoft account hasn't been given access to Trigon yet. Ask an administrator.");
    }

    return this.identity.upsertExternal({
      provider: 'entra',
      providerAccountId: oid,
      email,
      displayName: String(claims.name ?? email),
      active: true,
      profile: { tid: claims.tid, upn: claims.preferred_username },
    }, { linkUserId });
  }
}

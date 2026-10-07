import { BadRequestException, Injectable } from '@nestjs/common';
import { EntraClientService } from '../directory/entra-client.service';
import { IdentityService } from '../users/identity.service';

const SCOPES = ['openid', 'profile', 'email', 'User.Read'];

export interface EntraLoginState {
  state: string;
  verifier: string;
  returnTo: string;
}

/** OIDC authorization-code + PKCE sign-in with Microsoft Entra ID, via MSAL. */
@Injectable()
export class EntraAuthService {
  constructor(
    private readonly entra: EntraClientService,
    private readonly identity: IdentityService,
  ) {}

  enabled() {
    return this.entra.enabled();
  }

  async begin(returnTo: string): Promise<{ url: string; login: EntraLoginState }> {
    const { verifier, challenge } = await this.entra.crypto.generatePkceCodes();
    const state = this.entra.crypto.createNewGuid();
    const url = await (await this.entra.client()).getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: await this.entra.redirectUri(),
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      state,
      prompt: 'select_account',
    });
    return { url, login: { state, verifier, returnTo } };
  }

  async complete(code: string, state: string, login: EntraLoginState | undefined) {
    if (!login || login.state !== state) throw new BadRequestException('Invalid or expired sign-in state');
    const result = await (await this.entra.client()).acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: await this.entra.redirectUri(),
      codeVerifier: login.verifier,
    });
    const claims = result.idTokenClaims as Record<string, unknown>;
    const oid = String(claims.oid ?? result.uniqueId);
    const email = String(claims.email ?? claims.preferred_username ?? result.account?.username ?? '');
    if (!oid || !email) throw new BadRequestException('Entra token is missing oid/email claims');

    return this.identity.upsertExternal({
      provider: 'entra',
      providerAccountId: oid,
      email,
      displayName: String(claims.name ?? email),
      active: true,
      profile: { tid: claims.tid, upn: claims.preferred_username },
    });
  }
}

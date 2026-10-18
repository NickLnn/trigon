import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { EntraSignInStatus } from '@trigon/shared';
import type { Request } from 'express';
import { SettingsService } from '../settings/settings.service';
import { EntraClientService } from './entra-client.service';

export const ENTRA_CALLBACK_PATH = '/api/auth/entra/callback';
/** Learned HTTPS addresses kept (newest win). */
const MAX_ORIGINS = 10;

/** Microsoft accepts https:// redirect URIs, and http:// only for localhost. */
export const redirectAllowed = (uri: string) => uri.startsWith('https://') || /^http:\/\/localhost[:/]/.test(uri);

const firstValue = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0].trim() || undefined;

/**
 * Browser-facing origin of a request as seen through Cloudflare / a reverse proxy and the Next.js
 * rewrite (which forwards the original Host as X-Forwarded-Host and keeps X-Forwarded-Proto).
 */
export function requestOrigin(req: Pick<Request, 'headers' | 'protocol'>): string | null {
  const h = req.headers;
  const cfHttps = typeof h['cf-visitor'] === 'string' && h['cf-visitor'].includes('"https"');
  const proto = (cfHttps ? 'https' : firstValue(h['x-forwarded-proto']) ?? req.protocol)?.toLowerCase();
  const host = firstValue(h['x-forwarded-host']) ?? h.host;
  if ((proto !== 'https' && proto !== 'http') || !host) return null;
  if (!/^([a-z0-9-]+\.)*[a-z0-9-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:.]+\](:\d{1,5})?$/i.test(host)) return null;
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

interface GraphWeb {
  homePageUrl?: string | null;
  logoutUrl?: string | null;
  implicitGrantSettings?: unknown;
  redirectUris?: string[];
}

/**
 * Keeps "Sign in with Microsoft" working wherever Trigon is reachable, without anyone editing the app
 * registration in the Azure portal:
 *
 * - the redirect URI follows the address the browser actually uses, as long as that address is trusted
 *   (APP_URL, or an HTTPS address an admin has opened Trigon at — request headers alone are never
 *   trusted, otherwise anyone could get their own domain registered as a redirect target);
 * - every trusted redirect URI is added to the app registration through Graph. The app Trigon creates
 *   owns itself and holds Application.ReadWrite.OwnedBy, which is exactly enough for that.
 */
@Injectable()
export class EntraRedirectService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EntraRedirectService.name);
  private status: EntraSignInStatus = { redirectUris: [], state: 'unknown', message: null };
  /** Fingerprint (client id + URIs) of the last successful check. */
  private verified?: string;
  private running?: Promise<EntraSignInStatus>;
  private learning = new Set<string>();

  constructor(
    private readonly settings: SettingsService,
    private readonly entra: EntraClientService,
  ) {
    settings.changes.on('changed', (key) => key === 'entra' && void this.ensure());
  }

  onApplicationBootstrap() {
    void this.ensure();
  }

  /** The address to fall back to: the public one when set, else the internal one. */
  private async appOrigin() {
    return new URL(await this.settings.publicUrl()).origin;
  }

  private async trustedOrigins(): Promise<string[]> {
    const s = await this.settings.get('entra');
    const g = await this.settings.get('general');
    const own = [g.publicUrl, await this.settings.internalUrl()].filter(Boolean).map((u) => new URL(u).origin);
    return [...new Set([...own, ...(s.signInOrigins ?? [])])];
  }

  /** Every callback URL Microsoft has to accept (an explicit Redirect URI setting overrides the rest). */
  async wanted(): Promise<string[]> {
    const s = await this.settings.get('entra');
    const uris = s.redirectUri ? [s.redirectUri] : (await this.trustedOrigins()).map((o) => `${o}${ENTRA_CALLBACK_PATH}`);
    return uris.filter(redirectAllowed);
  }

  /** Redirect URI for a sign-in started by this request, and the origin to return the browser to. */
  async forRequest(req: Request): Promise<{ redirectUri: string; origin: string }> {
    const s = await this.settings.get('entra');
    if (s.redirectUri) return { redirectUri: s.redirectUri, origin: new URL(s.redirectUri).origin };
    const seen = requestOrigin(req);
    const trusted = await this.trustedOrigins();
    let origin = seen && trusted.includes(seen) ? seen : await this.appOrigin();
    // Opened over plain http on the LAN: sign in through a known HTTPS address instead (the session
    // then lives there), since Microsoft won't redirect back to http.
    if (!redirectAllowed(`${origin}${ENTRA_CALLBACK_PATH}`)) origin = trusted.find((o) => o.startsWith('https://')) ?? origin;
    return { redirectUri: `${origin}${ENTRA_CALLBACK_PATH}`, origin };
  }

  /**
   * Validate the public address an admin confirmed in "Connect to Microsoft" and put it first in the
   * trusted list. Only https:// is accepted (http://localhost for development).
   */
  async confirmOrigin(publicUrl: string, userId?: string): Promise<string> {
    let origin: string;
    try {
      origin = new URL(publicUrl.trim()).origin;
    } catch {
      throw new BadRequestException('Enter the full address, e.g. https://trigon.example.com');
    }
    if (!redirectAllowed(`${origin}${ENTRA_CALLBACK_PATH}`)) {
      throw new BadRequestException('Microsoft only accepts HTTPS addresses for sign-in. Enter the https:// address people use to open Trigon.');
    }
    const current = (await this.settings.get('entra')).signInOrigins ?? [];
    await this.settings.update('entra', { signInOrigins: [origin, ...current.filter((o) => o !== origin)].slice(0, MAX_ORIGINS) }, userId);
    return origin;
  }

  /** Remember the HTTPS address an admin is using, so Microsoft sign-in works there too. */
  async learnFromAdmin(req: Request, adminId?: string): Promise<void> {
    const origin = requestOrigin(req);
    if (!origin?.startsWith('https://') || this.learning.has(origin)) return;
    if ((await this.trustedOrigins()).includes(origin)) return;
    this.learning.add(origin);
    try {
      const current = (await this.settings.get('entra')).signInOrigins ?? [];
      // Audited as the admin's change: it adds a trusted sign-in redirect address.
      await this.settings.update('entra', { signInOrigins: [...current, origin].slice(-MAX_ORIGINS) }, adminId);
      this.logger.log(`Learned public address ${origin} for Microsoft sign-in`);
    } finally {
      this.learning.delete(origin);
    }
  }

  current(): EntraSignInStatus {
    return this.status;
  }

  /** Called by the provisioner, which registered the URIs itself with the admin's token. */
  markRegistered(clientId: string, redirectUris: string[]) {
    this.verified = `${clientId}|${redirectUris.join(' ')}`;
    this.status = { redirectUris, state: redirectUris.length ? 'ok' : 'none', message: redirectUris.length ? null : NO_HTTPS };
  }

  /** Make sure every wanted redirect URI is on the app registration. Never throws. */
  ensure(): Promise<EntraSignInStatus> {
    this.running ??= this.check().finally(() => (this.running = undefined));
    return this.running;
  }

  private async check(): Promise<EntraSignInStatus> {
    let redirectUris: string[] = [];
    try {
      redirectUris = await this.wanted();
      if (!redirectUris.length) return (this.status = { redirectUris, state: 'none', message: NO_HTTPS });
      if (!(await this.entra.enabled())) return (this.status = { redirectUris, state: 'unknown', message: null });

      const { clientId } = await this.settings.get('entra');
      const fingerprint = `${clientId}|${redirectUris.join(' ')}`;
      if (this.verified === fingerprint) return this.status;

      const app = await this.entra.graphGet<{ id: string; web?: GraphWeb }>(`/applications(appId='${clientId}')?$select=id,web`);
      if (!app) return (this.status = { redirectUris, state: 'reconnect', message: RECONNECT });
      const have = app.web?.redirectUris ?? [];
      const missing = redirectUris.filter((u) => !have.includes(u));
      if (missing.length) {
        const { homePageUrl, logoutUrl, implicitGrantSettings } = app.web ?? {};
        await this.entra.graphPatch(`/applications/${app.id}`, {
          web: { homePageUrl, logoutUrl, implicitGrantSettings, redirectUris: [...have, ...missing] },
        });
        this.logger.log(`Registered Microsoft sign-in redirect ${missing.join(', ')}`);
      }
      this.verified = fingerprint;
      return (this.status = { redirectUris, state: 'ok', message: null });
    } catch (err) {
      const message = (err as Error).message;
      const denied = /\b403\b|Authorization_RequestDenied|Insufficient privileges/i.test(message);
      if (!denied) this.logger.warn(`Could not check Microsoft sign-in redirects: ${message}`);
      return (this.status = { redirectUris, state: denied ? 'reconnect' : 'error', message: denied ? RECONNECT : message });
    }
  }
}

const NO_HTTPS =
  'Sign in with Microsoft turns on automatically as soon as an administrator opens Trigon over HTTPS (Microsoft rejects http:// addresses other than localhost).';
const RECONNECT =
  "Trigon isn't allowed to update its Microsoft app registration yet, so new sign-in addresses can't be registered automatically. Click Reconnect once to fix this.";

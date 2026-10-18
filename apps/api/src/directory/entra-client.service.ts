import { ConfidentialClientApplication, CryptoProvider, LogLevel } from '@azure/msal-node';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { EntraSettings } from '@trigon/shared';
import { SettingsService } from '../settings/settings.service';

export const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Whether a URL is on Microsoft Graph over HTTPS (the only place the app token may be sent). */
export const isGraphUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'graph.microsoft.com' && !u.username && !u.password;
  } catch {
    return false;
  }
};

/**
 * One MSAL confidential client shared by OIDC sign-in and Graph directory sync. Configuration comes
 * from Settings, so the client is rebuilt whenever an admin changes the tenant, client id or secret.
 */
@Injectable()
export class EntraClientService {
  private readonly logger = new Logger(EntraClientService.name);
  private cca?: { fingerprint: string; client: ConfidentialClientApplication };
  readonly crypto = new CryptoProvider();

  constructor(private readonly settings: SettingsService) {
    settings.changes.on('changed', (key) => key === 'entra' && (this.cca = undefined));
  }

  async enabled() {
    const s = await this.settings.get('entra');
    return s.enabled && !!s.tenantId && !!s.clientId && !!s.clientSecret;
  }

  /** Build a client for explicit settings (used by "Test connection" before saving). */
  static build(s: Pick<EntraSettings, 'tenantId' | 'clientId' | 'clientSecret'>, logger?: Logger) {
    return new ConfidentialClientApplication({
      auth: {
        clientId: s.clientId,
        authority: `https://login.microsoftonline.com/${s.tenantId}`,
        clientSecret: s.clientSecret!,
      },
      system: {
        loggerOptions: {
          logLevel: LogLevel.Warning,
          piiLoggingEnabled: false,
          loggerCallback: (_level, message) => logger?.warn(message),
        },
      },
    });
  }

  async client(): Promise<ConfidentialClientApplication> {
    const s = await this.settings.get('entra');
    if (!(await this.enabled())) throw new ServiceUnavailableException('Microsoft Entra ID is not configured');
    const fingerprint = `${s.tenantId}|${s.clientId}|${s.clientSecret}`;
    if (this.cca?.fingerprint !== fingerprint) {
      this.cca = { fingerprint, client: EntraClientService.build(s, this.logger) };
    }
    return this.cca.client;
  }

  /** App-only Graph token (client credentials grant). */
  static async appToken(client: ConfidentialClientApplication): Promise<string> {
    const result = await client.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
    if (!result?.accessToken) throw new ServiceUnavailableException('Could not acquire Graph token');
    return result.accessToken;
  }

  /** GET a single Graph object; null when it no longer exists. */
  async graphGet<T>(path: string): Promise<T | null> {
    const token = await EntraClientService.appToken(await this.client());
    const res = await fetch(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** PATCH a Graph object with the app token. */
  async graphPatch(path: string, body: unknown): Promise<void> {
    const token = await EntraClientService.appToken(await this.client());
    const res = await fetch(`${GRAPH}${path}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  }

  /** DELETE a Graph object with the app token; false when it was already gone. */
  async graphDelete(path: string): Promise<boolean> {
    const token = await EntraClientService.appToken(await this.client());
    const res = await fetch(`${GRAPH}${path}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    return true;
  }

  /** One page of a Graph collection (for pickers / search). */
  async graphPage<T>(path: string): Promise<T[]> {
    const token = await EntraClientService.appToken(await this.client());
    const res = await fetch(`${GRAPH}${path}`, {
      headers: { authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { value: T[] }).value;
  }

  /** GET a Graph collection, following @odata.nextLink until exhausted. */
  async graphList<T>(path: string): Promise<T[]> {
    const token = await EntraClientService.appToken(await this.client());
    const out: T[] = [];
    let next: string | undefined = `${GRAPH}${path}`;
    while (next) {
      // The app token only ever goes to Microsoft Graph, whatever a response's next link says.
      if (!isGraphUrl(next)) throw new Error('Microsoft Graph returned a next link to another host');
      const res = await fetch(next, {
        headers: { authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') ?? 5);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { value: T[]; '@odata.nextLink'?: string };
      out.push(...body.value);
      next = body['@odata.nextLink'];
    }
    return out;
  }
}

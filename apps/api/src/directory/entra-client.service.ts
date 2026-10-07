import { ConfidentialClientApplication, CryptoProvider, LogLevel } from '@azure/msal-node';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** One MSAL confidential client shared by OIDC sign-in and Graph directory sync. */
@Injectable()
export class EntraClientService {
  private readonly logger = new Logger(EntraClientService.name);
  private cca?: ConfidentialClientApplication;
  readonly crypto = new CryptoProvider();

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return this.config.get('ENTRA_ENABLED') === 'true';
  }

  get redirectUri(): string {
    return (
      this.config.get('ENTRA_REDIRECT_URI') ||
      `${this.config.getOrThrow<string>('APP_URL')}/api/auth/entra/callback`
    );
  }

  client(): ConfidentialClientApplication {
    if (!this.enabled) throw new ServiceUnavailableException('Microsoft Entra ID is not enabled');
    this.cca ??= new ConfidentialClientApplication({
      auth: {
        clientId: this.config.getOrThrow('ENTRA_CLIENT_ID'),
        authority: `https://login.microsoftonline.com/${this.config.getOrThrow('ENTRA_TENANT_ID')}`,
        clientSecret: this.config.getOrThrow('ENTRA_CLIENT_SECRET'),
      },
      system: {
        loggerOptions: {
          logLevel: LogLevel.Warning,
          piiLoggingEnabled: false,
          loggerCallback: (_level, message) => this.logger.warn(message),
        },
      },
    });
    return this.cca;
  }

  /** App-only Graph token (client credentials grant). Requires admin-consented Directory.Read.All / User.Read.All. */
  private async appToken(): Promise<string> {
    const result = await this.client().acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });
    if (!result?.accessToken) throw new ServiceUnavailableException('Could not acquire Graph token');
    return result.accessToken;
  }

  /** GET a Graph collection, following @odata.nextLink until exhausted. */
  async graphList<T>(path: string): Promise<T[]> {
    const token = await this.appToken();
    const out: T[] = [];
    let next: string | undefined = path.startsWith('http') ? path : `${GRAPH}${path}`;
    while (next) {
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

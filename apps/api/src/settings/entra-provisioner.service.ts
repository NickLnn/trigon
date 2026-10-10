import { PublicClientApplication } from '@azure/msal-node';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { EntraProvisionStatus } from '@trigon/shared';
import { GRAPH } from '../directory/entra-client.service';
import { SettingsService } from './settings.service';

/** Microsoft's first-party "Microsoft Graph Command Line Tools" public client (what Connect-MgGraph uses). */
const GRAPH_CLI_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const MS_GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';

/** Delegated scopes the signed-in admin grants for this one-off setup. */
const SETUP_SCOPES = [
  'https://graph.microsoft.com/Application.ReadWrite.All',
  'https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All',
  'https://graph.microsoft.com/DelegatedPermissionGrant.ReadWrite.All',
  'https://graph.microsoft.com/Organization.Read.All',
];

/** What the created Trigon app gets. */
const APP_ROLES = ['User.Read.All', 'Group.Read.All', 'GroupMember.Read.All'];
const DELEGATED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read'];

const STEPS = [
  'Sign in as a Microsoft Entra administrator',
  'Create the "Trigon" app registration',
  'Create its service principal and client secret',
  'Grant admin consent for directory read access',
  'Save the connection in Trigon',
];

interface GraphSp {
  id: string;
  appRoles: { id: string; value: string }[];
  oauth2PermissionScopes: { id: string; value: string }[];
}

/**
 * One-click Entra ID setup ("Connect to Microsoft").
 *
 * The admin signs in through the device-code flow (enter a short code at microsoft.com/devicelogin);
 * with that delegated token Trigon registers its own app in the tenant, grants it admin consent for
 * User.Read.All / Group.Read.All / GroupMember.Read.All (+ sign-in scopes), creates a client secret and
 * stores everything in Settings. The setup token is discarded afterwards.
 */
@Injectable()
export class EntraProvisionerService {
  private readonly logger = new Logger(EntraProvisionerService.name);
  private status: EntraProvisionStatus = { state: 'idle', steps: STEPS.map((label) => ({ label, done: false })) };

  constructor(private readonly settings: SettingsService) {}

  current(): EntraProvisionStatus {
    return this.status;
  }

  private step(index: number) {
    this.status = { ...this.status, steps: this.status.steps.map((s, i) => ({ ...s, done: i <= index })) };
  }

  /** Starts the device-code flow; resolves once Microsoft has issued the user code. */
  async start(userId: string): Promise<EntraProvisionStatus> {
    if (this.status.state === 'waiting_for_sign_in' || this.status.state === 'working') {
      throw new ConflictException('A Microsoft connection is already in progress');
    }
    this.status = { state: 'waiting_for_sign_in', steps: STEPS.map((label) => ({ label, done: false })) };

    const pca = new PublicClientApplication({
      auth: { clientId: GRAPH_CLI_CLIENT_ID, authority: 'https://login.microsoftonline.com/organizations' },
    });

    let announce!: () => void;
    const codeIssued = new Promise<void>((resolve) => (announce = resolve));

    pca
      .acquireTokenByDeviceCode({
        scopes: SETUP_SCOPES,
        timeout: 900,
        deviceCodeCallback: (r) => {
          this.status = {
            ...this.status,
            userCode: r.userCode,
            verificationUri: r.verificationUri,
            expiresAt: new Date(Date.now() + r.expiresIn * 1000).toISOString(),
          };
          announce();
        },
      })
      .then(async (result) => {
        if (!result?.accessToken) throw new Error('Sign-in did not return a token');
        this.step(0);
        this.status = { ...this.status, state: 'working', userCode: undefined };
        await this.provision(result.accessToken, result.tenantId, userId);
        this.status = { ...this.status, state: 'done', message: this.status.message ?? 'Microsoft Entra ID is connected.' };
      })
      .catch((err: Error) => {
        this.logger.error(`Entra provisioning failed: ${err.message}`);
        this.status = { ...this.status, state: 'error', userCode: undefined, message: err.message };
        announce();
      });

    await codeIssued;
    return this.status;
  }

  private async graph<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      let message = text;
      try {
        message = JSON.parse(text).error?.message ?? text;
      } catch {
        /* not JSON */
      }
      throw new Error(`${method} ${path.split('?')[0]} → ${res.status}: ${message}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private async provision(token: string, tenantId: string, userId: string) {
    const redirectUri = await this.settings.entraRedirectUri();
    const graphSp = await this.graph<GraphSp>(
      token,
      'GET',
      `/servicePrincipals(appId='${MS_GRAPH_APP_ID}')?$select=id,appRoles,oauth2PermissionScopes`,
    );
    const roleIds = APP_ROLES.map((v) => {
      const role = graphSp.appRoles.find((r) => r.value === v);
      if (!role) throw new Error(`Graph app role ${v} not found`);
      return role.id;
    });
    const scopeIds = DELEGATED_SCOPES.map((v) => {
      const scope = graphSp.oauth2PermissionScopes.find((s) => s.value === v);
      if (!scope) throw new Error(`Graph scope ${v} not found`);
      return scope.id;
    });

    // Entra only accepts http:// redirect URIs for localhost; other http URLs are left out
    // (sign-in then needs HTTPS, but directory sync works regardless).
    const redirectAllowed = redirectUri.startsWith('https://') || /^http:\/\/localhost[:/]/.test(redirectUri);
    const app = await this.graph<{ id: string; appId: string }>(token, 'POST', '/applications', {
      displayName: 'Trigon',
      signInAudience: 'AzureADMyOrg',
      web: { redirectUris: redirectAllowed ? [redirectUri] : [] },
      requiredResourceAccess: [
        {
          resourceAppId: MS_GRAPH_APP_ID,
          resourceAccess: [
            ...scopeIds.map((id) => ({ id, type: 'Scope' })),
            ...roleIds.map((id) => ({ id, type: 'Role' })),
          ],
        },
      ],
      notes: 'Created automatically by Trigon (Settings → Microsoft Entra ID).',
    });
    this.step(1);

    const sp = await this.graph<{ id: string }>(token, 'POST', '/servicePrincipals', { appId: app.appId });
    const secret = await this.graph<{ secretText: string }>(token, 'POST', `/applications/${app.id}/addPassword`, {
      passwordCredential: {
        displayName: 'Trigon server',
        endDateTime: new Date(Date.now() + 2 * 365 * 86_400_000).toISOString(),
      },
    });
    this.step(2);

    for (const appRoleId of roleIds) {
      await this.graph(token, 'POST', `/servicePrincipals/${graphSp.id}/appRoleAssignedTo`, {
        principalId: sp.id,
        resourceId: graphSp.id,
        appRoleId,
      });
    }
    await this.graph(token, 'POST', '/oauth2PermissionGrants', {
      clientId: sp.id,
      consentType: 'AllPrincipals',
      resourceId: graphSp.id,
      scope: DELEGATED_SCOPES.join(' '),
    });
    this.step(3);

    await this.settings.update(
      'entra',
      {
        enabled: true,
        tenantId,
        clientId: app.appId,
        clientSecret: secret.secretText,
        provisionedAppId: app.appId,
        // Nothing is imported until the admin picks which groups / users get access.
        syncScope: 'selected',
        syncGroups: [],
        syncUsers: [],
      },
      userId,
    );
    this.step(4);
    if (!redirectAllowed) {
      this.status = {
        ...this.status,
        message: `Connected. Note: Microsoft only allows sign-in redirects to HTTPS addresses, so "Sign in with Microsoft" will work once Trigon is served over HTTPS (add ${redirectUri.replace('http://', 'https://')} as a redirect URI then). Directory sync works now.`,
      };
    }
  }
}

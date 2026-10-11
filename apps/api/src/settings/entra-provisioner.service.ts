import { PublicClientApplication } from '@azure/msal-node';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { EntraProvisionStatus } from '@trigon/shared';
import { EntraClientService, GRAPH } from '../directory/entra-client.service';
import { EntraRedirectService } from '../directory/entra-redirect.service';
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

/**
 * What the created Trigon app gets. Application.ReadWrite.OwnedBy (the app owns only itself) lets
 * Trigon add new sign-in redirect addresses to its own registration later, without an admin.
 */
const APP_ROLES = ['User.Read.All', 'Group.Read.All', 'GroupMember.Read.All', 'Application.ReadWrite.OwnedBy'];
const DELEGATED_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read'];

const STEPS = [
  'Sign in as a Microsoft Entra administrator',
  'Create or update the "Trigon" app registration',
  'Create its service principal and client secret',
  'Grant admin consent for directory read access',
  'Save the connection in Trigon',
];

interface GraphApp {
  id: string;
  appId: string;
  web?: { homePageUrl?: string | null; logoutUrl?: string | null; implicitGrantSettings?: unknown; redirectUris?: string[] };
}

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
 *
 * Running it again ("Reconnect") updates the app Trigon created before — permissions, ownership and
 * redirect URIs — instead of registering a duplicate, and keeps the stored client secret.
 */
@Injectable()
export class EntraProvisionerService {
  private readonly logger = new Logger(EntraProvisionerService.name);
  private status: EntraProvisionStatus = { state: 'idle', steps: STEPS.map((label) => ({ label, done: false })) };

  constructor(
    private readonly settings: SettingsService,
    private readonly redirects: EntraRedirectService,
    private readonly entra: EntraClientService,
  ) {}

  current(): EntraProvisionStatus {
    return this.status;
  }

  private step(index: number) {
    this.status = { ...this.status, steps: this.status.steps.map((s, i) => ({ ...s, done: i <= index })) };
  }

  private busy() {
    return this.status.state === 'waiting_for_sign_in' || this.status.state === 'working';
  }

  /**
   * Starts the device-code flow; resolves once Microsoft has issued the user code. `publicUrl` is the
   * HTTPS address the admin confirmed — the sign-in redirect is registered for it (never for the
   * internal LAN address).
   */
  async start(userId: string, publicUrl: string): Promise<EntraProvisionStatus> {
    if (this.busy()) throw new ConflictException('A Microsoft connection is already in progress');
    await this.redirects.confirmOrigin(publicUrl);
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

  /**
   * Disconnect: delete the app registration Trigon created (it owns itself, so its own token may) and
   * clear the stored connection, so "Connect to Microsoft" starts from scratch.
   */
  async disconnect(userId: string): Promise<{ ok: boolean; message: string }> {
    if (this.busy()) throw new ConflictException('A Microsoft connection is in progress');
    const s = await this.settings.get('entra');
    let message = 'Disconnected from Microsoft.';
    if (s.provisionedAppId && s.provisionedAppId === s.clientId && (await this.entra.enabled())) {
      try {
        const deleted = await this.entra.graphDelete(`/applications(appId='${s.provisionedAppId}')`);
        message = deleted
          ? 'Disconnected. The "Trigon" app registration was deleted from your Microsoft tenant.'
          : 'Disconnected. The "Trigon" app registration was already gone from your Microsoft tenant.';
      } catch (err) {
        // AADSTS700016: the application no longer exists in the tenant (deleted in the portal).
        if (/AADSTS700016/.test((err as Error).message)) {
          message = 'Disconnected. The "Trigon" app registration was already gone from your Microsoft tenant.';
        } else {
          this.logger.warn(`Could not delete the Entra app registration: ${(err as Error).message}`);
          message = 'Disconnected in Trigon, but the "Trigon" app registration could not be deleted automatically. Remove it under Microsoft Entra ID → App registrations if you no longer need it.';
        }
      }
    } else if (s.clientId) {
      message = 'Disconnected. This app registration was not created by Trigon, so it was left in your Microsoft tenant.';
    }
    await this.settings.update(
      'entra',
      { enabled: false, tenantId: '', clientId: '', clientSecret: null as unknown as string, provisionedAppId: null, syncGroups: [], syncUsers: [] },
      userId,
    );
    this.status = { state: 'idle', steps: STEPS.map((label) => ({ label, done: false })) };
    return { ok: true, message };
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

  /** Like graph(), but null when the object does not exist. */
  private async graphFind<T>(token: string, path: string): Promise<T | null> {
    try {
      return await this.graph<T>(token, 'GET', path);
    } catch (err) {
      if (/→ 404:/.test((err as Error).message)) return null;
      throw err;
    }
  }

  private async provision(token: string, tenantId: string, userId: string) {
    // Every address Trigon is known to be reachable at over HTTPS (or localhost).
    const redirectUris = await this.redirects.wanted();
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
    const requiredResourceAccess = [
      {
        resourceAppId: MS_GRAPH_APP_ID,
        resourceAccess: [...scopeIds.map((id) => ({ id, type: 'Scope' })), ...roleIds.map((id) => ({ id, type: 'Role' }))],
      },
    ];

    // Reconnect: update the app Trigon created earlier rather than registering another one.
    const stored = await this.settings.get('entra');
    const existing =
      stored.provisionedAppId && stored.tenantId === tenantId
        ? await this.graphFind<GraphApp>(token, `/applications(appId='${stored.provisionedAppId}')?$select=id,appId,web`)
        : null;
    let app: GraphApp;
    if (existing) {
      const have = existing.web?.redirectUris ?? [];
      const { homePageUrl, logoutUrl, implicitGrantSettings } = existing.web ?? {};
      await this.graph(token, 'PATCH', `/applications/${existing.id}`, {
        requiredResourceAccess,
        web: { homePageUrl, logoutUrl, implicitGrantSettings, redirectUris: [...new Set([...have, ...redirectUris])] },
      });
      app = existing;
    } else {
      app = await this.graph<GraphApp>(token, 'POST', '/applications', {
        displayName: 'Trigon',
        signInAudience: 'AzureADMyOrg',
        web: { redirectUris },
        requiredResourceAccess,
        notes: 'Created automatically by Trigon (Settings → Microsoft Entra ID).',
      });
    }
    this.step(1);

    const sp =
      (await this.graphFind<{ id: string }>(token, `/servicePrincipals(appId='${app.appId}')?$select=id`)) ??
      (await this.graph<{ id: string }>(token, 'POST', '/servicePrincipals', { appId: app.appId }));
    // The app owns itself, so Application.ReadWrite.OwnedBy covers exactly its own registration.
    const owners = await this.graph<{ value: { id: string }[] }>(token, 'GET', `/applications/${app.id}/owners?$select=id`);
    if (!owners.value.some((o) => o.id === sp.id)) {
      await this.graph(token, 'POST', `/applications/${app.id}/owners/$ref`, { '@odata.id': `${GRAPH}/directoryObjects/${sp.id}` });
    }
    const keepSecret = !!existing && stored.clientId === app.appId && !!stored.clientSecret;
    const secret = keepSecret
      ? undefined
      : await this.graph<{ secretText: string }>(token, 'POST', `/applications/${app.id}/addPassword`, {
          passwordCredential: {
            displayName: 'Trigon server',
            endDateTime: new Date(Date.now() + 2 * 365 * 86_400_000).toISOString(),
          },
        });
    this.step(2);

    const assigned = await this.graph<{ value: { appRoleId: string; resourceId: string }[] }>(
      token,
      'GET',
      `/servicePrincipals/${sp.id}/appRoleAssignments`,
    );
    for (const appRoleId of roleIds) {
      if (assigned.value.some((a) => a.appRoleId === appRoleId && a.resourceId === graphSp.id)) continue;
      await this.graph(token, 'POST', `/servicePrincipals/${graphSp.id}/appRoleAssignedTo`, {
        principalId: sp.id,
        resourceId: graphSp.id,
        appRoleId,
      });
    }
    const grants = await this.graph<{ value: { id: string }[] }>(
      token,
      'GET',
      `/oauth2PermissionGrants?$filter=clientId eq '${sp.id}' and resourceId eq '${graphSp.id}' and consentType eq 'AllPrincipals'`,
    );
    if (grants.value.length) {
      await this.graph(token, 'PATCH', `/oauth2PermissionGrants/${grants.value[0].id}`, { scope: DELEGATED_SCOPES.join(' ') });
    } else {
      await this.graph(token, 'POST', '/oauth2PermissionGrants', {
        clientId: sp.id,
        consentType: 'AllPrincipals',
        resourceId: graphSp.id,
        scope: DELEGATED_SCOPES.join(' '),
      });
    }
    this.step(3);

    // Registered just now with the admin's token — no need to wait for the app's own permission to propagate.
    this.redirects.markRegistered(app.appId, redirectUris);
    await this.settings.update(
      'entra',
      existing
        ? { enabled: true, tenantId, clientId: app.appId, clientSecret: secret?.secretText, provisionedAppId: app.appId }
        : {
            enabled: true,
            tenantId,
            clientId: app.appId,
            clientSecret: secret!.secretText,
            provisionedAppId: app.appId,
            // Nothing is imported until the admin picks which groups / users get access.
            syncScope: 'selected',
            syncGroups: [],
            syncUsers: [],
          },
      userId,
    );
    this.step(4);
    if (!redirectUris.length) {
      this.status = {
        ...this.status,
        message:
          'Connected. Directory sync works now. "Sign in with Microsoft" switches on by itself the first time an administrator opens Trigon over HTTPS (Microsoft rejects http:// addresses other than localhost).',
      };
    }
  }
}

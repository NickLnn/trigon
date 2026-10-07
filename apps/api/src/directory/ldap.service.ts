import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { LdapSettings } from '@trigon/shared';
import { Client, type Entry } from 'ldapts';
import { SettingsService } from '../settings/settings.service';

export interface LdapUser {
  dn: string;
  /** objectGUID (hex) when available, otherwise the DN. Stable across renames on AD. */
  externalId: string;
  username: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  disabled: boolean;
  memberOf: string[];
}

export interface LdapGroup {
  dn: string;
  name: string;
  description: string | null;
  members: string[];
}

const USER_ATTRS = [
  'dn',
  'objectGUID',
  'sAMAccountName',
  'userPrincipalName',
  'uid',
  'mail',
  'displayName',
  'cn',
  'title',
  'department',
  'memberOf',
  'userAccountControl',
];

/** RFC 4515 filter value escaping. */
export function escapeLdapFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

const first = (v: Entry[string] | undefined): string | null => {
  if (v === undefined) return null;
  const x = Array.isArray(v) ? v[0] : v;
  return x === undefined ? null : x.toString();
};
const all = (v: Entry[string] | undefined): string[] =>
  v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => x.toString());

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(private readonly settings: SettingsService) {}

  async enabled() {
    const s = await this.settings.get('ldap');
    return s.enabled && !!s.url;
  }

  private async resolve(override?: LdapSettings): Promise<LdapSettings> {
    if (override) return override;
    if (!(await this.enabled())) throw new ServiceUnavailableException('LDAP is not enabled');
    return this.settings.get('ldap');
  }

  private client(s: LdapSettings) {
    return new Client({
      url: s.url,
      timeout: 10_000,
      connectTimeout: 10_000,
      tlsOptions: { rejectUnauthorized: s.tlsRejectUnauthorized },
    });
  }

  private async withServiceBind<T>(s: LdapSettings, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = this.client(s);
    try {
      await c.bind(s.bindDn, s.bindPassword ?? '');
      return await fn(c);
    } finally {
      await c.unbind().catch(() => undefined);
    }
  }

  private toUser(e: Entry): LdapUser {
    const guid = e.objectGUID;
    const guidHex = Buffer.isBuffer(guid) ? guid.toString('hex') : Array.isArray(guid) && Buffer.isBuffer(guid[0]) ? guid[0].toString('hex') : null;
    const uac = Number(first(e.userAccountControl) ?? 0);
    const username = first(e.sAMAccountName) ?? first(e.uid) ?? first(e.userPrincipalName) ?? e.dn;
    return {
      dn: e.dn,
      externalId: guidHex ?? e.dn,
      username,
      email: first(e.mail) ?? first(e.userPrincipalName) ?? `${username}@ldap.invalid`,
      displayName: first(e.displayName) ?? first(e.cn) ?? username,
      jobTitle: first(e.title),
      department: first(e.department),
      // ACCOUNTDISABLE flag on Active Directory
      disabled: (uac & 0x2) === 0x2,
      memberOf: all(e.memberOf),
    };
  }

  /**
   * Verify domain credentials: find the user's DN with the service account, then bind as that DN.
   * Returns null when the user does not exist or the password is wrong.
   */
  async authenticate(username: string, password: string): Promise<LdapUser | null> {
    if (!username || !password) return null; // an empty password would be an unauthenticated bind
    const s = await this.resolve();
    const filter = s.userFilter.replaceAll('{{username}}', escapeLdapFilter(username));
    const entry = await this.withServiceBind(s, async (c) => {
      const { searchEntries } = await c.search(s.searchBase, {
        scope: 'sub',
        filter,
        attributes: USER_ATTRS,
        explicitBufferAttributes: ['objectGUID'],
        sizeLimit: 2,
      });
      return searchEntries.length === 1 ? searchEntries[0] : null;
    });
    if (!entry) return null;

    const userClient = this.client(s);
    try {
      await userClient.bind(entry.dn, password);
    } catch (err) {
      this.logger.debug(`LDAP bind failed for ${username}: ${(err as Error).message}`);
      return null;
    } finally {
      await userClient.unbind().catch(() => undefined);
    }
    const user = this.toUser(entry);
    return user.disabled ? null : user;
  }

  async listUsers(override?: LdapSettings): Promise<LdapUser[]> {
    const s = await this.resolve(override);
    return this.withServiceBind(s, async (c) => {
      const { searchEntries } = await c.search(s.searchBase, {
        scope: 'sub',
        filter: s.syncUserFilter,
        attributes: USER_ATTRS,
        explicitBufferAttributes: ['objectGUID'],
        paged: { pageSize: 500 },
      });
      return searchEntries.map((e) => this.toUser(e));
    });
  }

  async listGroups(override?: LdapSettings): Promise<LdapGroup[]> {
    const s = await this.resolve(override);
    return this.withServiceBind(s, async (c) => {
      const { searchEntries } = await c.search(s.searchBase, {
        scope: 'sub',
        filter: s.groupFilter,
        attributes: ['dn', 'cn', 'description', 'member'],
        paged: { pageSize: 500 },
      });
      return searchEntries.map((e) => ({
        dn: e.dn,
        name: first(e.cn) ?? e.dn,
        description: first(e.description),
        members: all(e.member),
      }));
    });
  }

  /** Settings-page check: bind with the service account and count what the filters find. */
  async test(s: LdapSettings): Promise<{ users: number; groups: number }> {
    const [users, groups] = [await this.listUsers(s), await this.listGroups(s)];
    return { users: users.length, groups: groups.length };
  }
}

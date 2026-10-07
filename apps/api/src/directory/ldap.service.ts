import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, type Entry } from 'ldapts';

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

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return this.config.get('LDAP_ENABLED') === 'true';
  }

  private client() {
    if (!this.enabled) throw new ServiceUnavailableException('LDAP is not enabled');
    return new Client({
      url: this.config.getOrThrow('LDAP_URL'),
      timeout: 10_000,
      connectTimeout: 10_000,
      tlsOptions: { rejectUnauthorized: this.config.get('LDAP_TLS_REJECT_UNAUTHORIZED') !== 'false' },
    });
  }

  private async withServiceBind<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = this.client();
    try {
      await c.bind(this.config.getOrThrow('LDAP_BIND_DN'), this.config.getOrThrow('LDAP_BIND_PASSWORD'));
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
    const filter = this.config.getOrThrow<string>('LDAP_USER_FILTER').replaceAll('{{username}}', escapeLdapFilter(username));
    const entry = await this.withServiceBind(async (c) => {
      const { searchEntries } = await c.search(this.config.getOrThrow('LDAP_SEARCH_BASE'), {
        scope: 'sub',
        filter,
        attributes: USER_ATTRS,
        explicitBufferAttributes: ['objectGUID'],
        sizeLimit: 2,
      });
      return searchEntries.length === 1 ? searchEntries[0] : null;
    });
    if (!entry) return null;

    const userClient = this.client();
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

  async listUsers(): Promise<LdapUser[]> {
    const filter = this.config.get<string>('LDAP_SYNC_USER_FILTER') ?? '(&(objectClass=user)(objectCategory=person))';
    return this.withServiceBind(async (c) => {
      const { searchEntries } = await c.search(this.config.getOrThrow('LDAP_SEARCH_BASE'), {
        scope: 'sub',
        filter,
        attributes: USER_ATTRS,
        explicitBufferAttributes: ['objectGUID'],
        paged: { pageSize: 500 },
      });
      return searchEntries.map((e) => this.toUser(e));
    });
  }

  async listGroups(): Promise<LdapGroup[]> {
    return this.withServiceBind(async (c) => {
      const { searchEntries } = await c.search(this.config.getOrThrow('LDAP_SEARCH_BASE'), {
        scope: 'sub',
        filter: this.config.get<string>('LDAP_GROUP_FILTER') ?? '(objectClass=group)',
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
}

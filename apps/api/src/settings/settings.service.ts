import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntraSettings, GeneralSettings, LdapSettings } from '@trigon/shared';
import { eq } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Database, InjectDb } from '../db/db.module';
import { settings } from '../db/schema';

export interface SettingsMap {
  general: GeneralSettings;
  entra: EntraSettings;
  ldap: LdapSettings;
}
export type SettingsKey = keyof SettingsMap;

/** Fields encrypted at rest. */
const SECRET_FIELDS: { [K in SettingsKey]: (keyof SettingsMap[K])[] } = {
  general: [],
  entra: ['clientSecret'],
  ldap: ['bindPassword'],
};

/**
 * Admin-editable configuration stored in Postgres, falling back to environment variables until an
 * admin saves a section in the UI. Secrets are AES-256-GCM encrypted with a key derived from
 * JWT_ACCESS_SECRET (or SETTINGS_ENCRYPTION_KEY when set).
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<SettingsKey, unknown>();
  private readonly key: Buffer;
  /** Emits the section key whenever a section is saved. */
  readonly changes = new EventEmitter();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    const material = config.get<string>('SETTINGS_ENCRYPTION_KEY') || config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.key = createHash('sha256').update(`trigon-settings:${material}`).digest();
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
  }

  private decrypt(value: string): string {
    if (!value.startsWith('enc:v1:')) return value;
    try {
      const [, , iv, tag, data] = value.split(':');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      this.logger.error('Could not decrypt a stored secret — was JWT_ACCESS_SECRET changed? Re-enter it in Settings.');
      return '';
    }
  }

  private defaults(): SettingsMap {
    const env = (k: string, d = '') => this.config.get<string>(k) ?? d;
    return {
      general: { allowLocalSignup: env('ALLOW_LOCAL_SIGNUP', 'true') !== 'false' },
      entra: {
        enabled: env('ENTRA_ENABLED') === 'true',
        tenantId: env('ENTRA_TENANT_ID'),
        clientId: env('ENTRA_CLIENT_ID'),
        clientSecret: env('ENTRA_CLIENT_SECRET'),
        redirectUri: env('ENTRA_REDIRECT_URI'),
        syncCron: env('ENTRA_SYNC_CRON', '0 */6 * * *'),
        provisionedAppId: null,
      },
      ldap: {
        enabled: env('LDAP_ENABLED') === 'true',
        url: env('LDAP_URL'),
        bindDn: env('LDAP_BIND_DN'),
        bindPassword: env('LDAP_BIND_PASSWORD'),
        searchBase: env('LDAP_SEARCH_BASE'),
        userFilter: env(
          'LDAP_USER_FILTER',
          '(&(objectClass=user)(|(sAMAccountName={{username}})(userPrincipalName={{username}})(mail={{username}})))',
        ),
        syncUserFilter: env('LDAP_SYNC_USER_FILTER', '(&(objectClass=user)(objectCategory=person))'),
        groupFilter: env('LDAP_GROUP_FILTER', '(objectClass=group)'),
        tlsRejectUnauthorized: env('LDAP_TLS_REJECT_UNAUTHORIZED', 'true') !== 'false',
        syncCron: env('LDAP_SYNC_CRON', '30 */6 * * *'),
      },
    };
  }

  /** Full section including decrypted secrets — server-side use only. */
  async get<K extends SettingsKey>(key: K): Promise<SettingsMap[K]> {
    if (this.cache.has(key)) return this.cache.get(key) as SettingsMap[K];
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key));
    const merged = { ...this.defaults()[key], ...(row?.value ?? {}) } as SettingsMap[K];
    for (const f of SECRET_FIELDS[key]) {
      const v = merged[f];
      if (typeof v === 'string') (merged as unknown as Record<string, unknown>)[f as string] = this.decrypt(v);
    }
    this.cache.set(key, merged);
    return merged;
  }

  /** Section safe to send to the browser: secrets replaced by has* flags. */
  async getPublic<K extends SettingsKey>(key: K): Promise<SettingsMap[K]> {
    const full = { ...(await this.get(key)) } as unknown as Record<string, unknown>;
    for (const f of SECRET_FIELDS[key] as string[]) {
      full[`has${f[0].toUpperCase()}${f.slice(1)}`] = !!full[f];
      delete full[f];
    }
    return full as unknown as SettingsMap[K];
  }

  /**
   * Merge and persist a section. Secret fields that are omitted or empty keep their stored value;
   * pass `null` to clear one explicitly.
   */
  async update<K extends SettingsKey>(key: K, patch: Partial<SettingsMap[K]>, userId?: string): Promise<SettingsMap[K]> {
    const current = await this.get(key);
    const next = { ...current, ...patch } as unknown as Record<string, unknown>;
    for (const f of SECRET_FIELDS[key] as string[]) {
      const incoming = (patch as Record<string, unknown>)[f];
      if (incoming === undefined || incoming === '') next[f] = (current as unknown as Record<string, unknown>)[f];
      if (incoming === null) next[f] = '';
    }
    for (const k of Object.keys(next)) if (k.startsWith('has')) delete next[k];

    const stored = { ...next };
    for (const f of SECRET_FIELDS[key] as string[]) {
      if (typeof stored[f] === 'string' && stored[f]) stored[f] = this.encrypt(stored[f] as string);
    }
    await this.db
      .insert(settings)
      .values({ key, value: stored, updatedById: userId })
      .onConflictDoUpdate({ target: settings.key, set: { value: stored, updatedById: userId } });
    this.cache.delete(key);
    this.changes.emit('changed', key);
    return this.get(key);
  }

  appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  async entraRedirectUri(): Promise<string> {
    return (await this.get('entra')).redirectUri || `${this.appUrl()}/api/auth/entra/callback`;
  }
}

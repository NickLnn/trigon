import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackupSettings, EmailSettings, EntraSettings, GeneralSettings, LdapSettings, SearchSettings } from '@trigon/shared';
import { eq } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import { Database, InjectDb } from '../db/db.module';
import { settings } from '../db/schema';
import { maskSecrets, SecretBox } from './secret-box';

export interface SettingsMap {
  general: GeneralSettings;
  entra: EntraSettings;
  ldap: LdapSettings;
  email: EmailSettings;
  backup: BackupSettings;
  search: SearchSettings;
}
export type SettingsKey = keyof SettingsMap;

/** Fields encrypted at rest and never sent to the browser. */
export const SECRET_FIELDS: { [K in SettingsKey]: (keyof SettingsMap[K])[] } = {
  general: [],
  entra: ['clientSecret'],
  ldap: ['bindPassword'],
  email: ['smtpPassword'],
  backup: ['smbPassword'],
  search: [],
};

/**
 * Admin-editable configuration stored in Postgres, falling back to environment variables until an
 * admin saves a section in the UI. Secrets are AES-256-GCM encrypted (see SecretBox) with a key derived
 * from SETTINGS_ENCRYPTION_KEY, or from JWT_ACCESS_SECRET on installs that don't set one yet.
 * SETTINGS_ENCRYPTION_KEY_PREVIOUS lets the key be rotated: values are re-encrypted on start-up.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<SettingsKey, unknown>();
  private readonly box: SecretBox;
  /** Emits the section key whenever a section is saved. */
  readonly changes = new EventEmitter();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    const dedicated = config.get<string>('SETTINGS_ENCRYPTION_KEY');
    const jwt = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    const previous = [config.get<string>('SETTINGS_ENCRYPTION_KEY_PREVIOUS') ?? '', ...(dedicated ? [jwt] : [])];
    this.box = new SecretBox(dedicated || jwt, previous);
    if (!dedicated) {
      this.logger.warn('SETTINGS_ENCRYPTION_KEY is not set: stored secrets are encrypted with a key derived from JWT_ACCESS_SECRET. Set a separate key (stored secrets are re-encrypted automatically).');
    }
  }

  /** Re-encrypt stored secrets that are plain text, in the old format or under a previous key. */
  async onModuleInit() {
    const rows = await this.db.select().from(settings);
    for (const row of rows) {
      const key = row.key as SettingsKey;
      const fields = (SECRET_FIELDS[key] ?? []) as string[];
      const value = (row.value ?? {}) as Record<string, unknown>;
      const stale = fields.filter((f) => typeof value[f] === 'string' && this.box.needsReencrypt(value[f] as string));
      if (!stale.length) continue;
      const next = { ...value };
      for (const f of stale) {
        const plain = this.box.decrypt(value[f] as string);
        if (plain === null) {
          this.logger.error(`Could not decrypt the stored ${key}.${f} with any configured key; re-enter it in Settings.`);
          continue;
        }
        next[f] = plain ? this.box.encrypt(plain) : '';
      }
      await this.db.update(settings).set({ value: next }).where(eq(settings.key, key));
      this.logger.log(`Re-encrypted stored secrets in "${key}" with the current key.`);
    }
  }

  private decrypt(value: string): string {
    const plain = this.box.decrypt(value);
    if (plain === null) {
      this.logger.error('Could not decrypt a stored secret — was the encryption key changed? Re-enter it in Settings.');
      return '';
    }
    return plain;
  }

  private defaults(): SettingsMap {
    const env = (k: string, d = '') => this.config.get<string>(k) ?? d;
    return {
      general: {
        allowLocalSignup: env('ALLOW_LOCAL_SIGNUP', 'true') !== 'false',
        internalUrl: env('APP_URL'),
        publicUrl: env('PUBLIC_URL'),
        setupDone: false,
      },
      entra: {
        enabled: env('ENTRA_ENABLED') === 'true',
        tenantId: env('ENTRA_TENANT_ID'),
        clientId: env('ENTRA_CLIENT_ID'),
        clientSecret: env('ENTRA_CLIENT_SECRET'),
        redirectUri: env('ENTRA_REDIRECT_URI'),
        syncCron: env('ENTRA_SYNC_CRON', '0 */6 * * *'),
        provisionedAppId: null,
        signInOrigins: [],
        syncScope: 'all',
        syncGroups: [],
        syncUsers: [],
        mailSend: false,
      },
      email: {
        provider: (['smtp', 'microsoft'].includes(env('EMAIL_PROVIDER')) ? env('EMAIL_PROVIDER') : 'none') as EmailSettings['provider'],
        fromAddress: env('EMAIL_FROM'),
        fromName: env('EMAIL_FROM_NAME', 'Trigon'),
        smtpHost: env('SMTP_HOST'),
        smtpPort: Number(env('SMTP_PORT', '587')),
        smtpSecurity: (['tls', 'none'].includes(env('SMTP_SECURITY')) ? env('SMTP_SECURITY') : 'starttls') as EmailSettings['smtpSecurity'],
        smtpUser: env('SMTP_USER'),
        smtpPassword: env('SMTP_PASSWORD'),
        smtpTlsRejectUnauthorized: env('SMTP_TLS_REJECT_UNAUTHORIZED', 'true') !== 'false',
      },
      backup: {
        enabled: env('BACKUP_ENABLED', 'true') !== 'false',
        schedule: env('BACKUP_SCHEDULE', '0 2 * * *'),
        keep: Number(env('BACKUP_KEEP', '14')) || 14,
        destinations: ['local'],
        localPath: env('BACKUP_DIR', '/data/backups'),
        nfsServer: '',
        nfsExport: '',
        smbHost: '',
        smbShare: '',
        smbPath: 'trigon-backups',
        smbUser: '',
        smbDomain: '',
        smbPassword: '',
        lastRun: null,
      },
      search: {
        ocrEnabled: env('OCR_ENABLED', 'true') !== 'false',
        ocrLanguages: env('OCR_LANGUAGES', 'ell+eng').split(/[+,\s]+/).filter(Boolean),
        ocrMaxPages: Number(env('OCR_MAX_PAGES', '50')) || 50,
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
    return maskSecrets(await this.get(key), SECRET_FIELDS[key] as string[]);
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
      if (typeof stored[f] === 'string' && stored[f]) stored[f] = this.box.encrypt(stored[f] as string);
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

  /** Where Trigon is reached on the LAN: Settings → General, else APP_URL. */
  async internalUrl(): Promise<string> {
    return (await this.get('general')).internalUrl || this.appUrl();
  }

  /** The public HTTPS address if one is known (set in General, or learned from an admin's browser). */
  async knownPublicUrl(): Promise<string | null> {
    const set = (await this.get('general')).publicUrl;
    if (set) return set;
    const origins = (await this.get('entra')).signInOrigins ?? [];
    return origins.find((o) => o.startsWith('https://')) ?? null;
  }

  /** The address to put in emails and links: the public one when known, else the internal one. */
  async publicUrl(): Promise<string> {
    return (await this.knownPublicUrl()) ?? (await this.internalUrl());
  }
}

/**
 * Types and constants shared by the API and the web app.
 * Keep this package dependency-free so both sides can import it cheaply.
 */

export const AUTH_PROVIDERS = ['local', 'entra', 'ldap'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const GROUP_SOURCES = ['local', 'entra', 'ldap'] as const;
export type GroupSource = (typeof GROUP_SOURCES)[number];

/** Workspace-wide role. Admins bypass resource permissions. */
export const SYSTEM_ROLES = ['admin', 'member', 'guest'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/**
 * Resource permission levels, ordered from weakest to strongest.
 * A grant on a space or folder is inherited by everything beneath it.
 */
export const PERMISSION_LEVELS = ['view', 'comment', 'edit', 'manage'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export function permissionRank(level: PermissionLevel | null | undefined): number {
  return level ? PERMISSION_LEVELS.indexOf(level) + 1 : 0;
}

export function atLeast(granted: PermissionLevel | null | undefined, required: PermissionLevel): boolean {
  return permissionRank(granted) >= permissionRank(required);
}

export const DOCUMENT_KINDS = ['folder', 'page', 'file'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: SystemRole;
  providers: AuthProvider[];
}

export interface AuthConfig {
  local: { enabled: boolean; signup: boolean };
  entra: { enabled: boolean };
  ldap: { enabled: boolean };
}

export interface SpaceSummary {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  myPermission: PermissionLevel;
}

export interface DocumentNode {
  id: string;
  spaceId: string;
  parentId: string | null;
  kind: DocumentKind;
  title: string;
  icon: string | null;
  position: number;
  mimeType: string | null;
  updatedAt: string;
  children?: DocumentNode[];
}

export interface EmbedInfo {
  url: string;
  provider: string | null;
  type: 'video' | 'rich' | 'link' | 'photo';
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  /** Sanitized iframe src for known video providers. */
  embedUrl: string | null;
  width: number | null;
  height: number | null;
}

/** Name of the httpOnly cookie carrying the short-lived access token. */
export const ACCESS_COOKIE = 'trigon_at';
/** Name of the httpOnly cookie carrying the rotating refresh token. */
export const REFRESH_COOKIE = 'trigon_rt';

export interface EmbedProviderMatch {
  provider: 'youtube' | 'vimeo' | 'loom';
  id: string;
  /** Privacy-friendly iframe src. */
  embedUrl: string;
  oembedEndpoint: string;
}

/**
 * Recognise video URLs we can embed directly as iframes, without a network round-trip.
 * Used by the editor (instant preview) and the API (oEmbed metadata).
 */
export function matchEmbedProvider(raw: string): EmbedProviderMatch | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const enc = encodeURIComponent(raw);

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/);
      id = m?.[1] ?? null;
    }
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const start = url.searchParams.get('t') ?? url.searchParams.get('start');
    const startSec = start ? parseInt(start, 10) : 0;
    return {
      provider: 'youtube',
      id,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}${startSec > 0 ? `?start=${startSec}` : ''}`,
      oembedEndpoint: `https://www.youtube.com/oembed?format=json&url=${enc}`,
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = url.pathname.match(/(?:^|\/)(?:video\/)?(\d{5,})(?:\/([\da-f]{6,}))?/);
    if (!m) return null;
    const hash = m[2] ?? url.searchParams.get('h');
    return {
      provider: 'vimeo',
      id: m[1],
      embedUrl: `https://player.vimeo.com/video/${m[1]}${hash ? `?h=${hash}` : ''}`,
      oembedEndpoint: `https://vimeo.com/api/oembed.json?url=${enc}`,
    };
  }

  if (host === 'loom.com') {
    const m = url.pathname.match(/^\/(?:share|embed)\/([\da-f]{16,})/);
    if (!m) return null;
    return {
      provider: 'loom',
      id: m[1],
      embedUrl: `https://www.loom.com/embed/${m[1]}`,
      oembedEndpoint: `https://www.loom.com/v1/oembed?url=${enc}`,
    };
  }

  return null;
}

// ─── Admin settings (secrets are never sent to the browser; `hasX` flags say whether one is stored) ───

export interface GeneralSettings {
  allowLocalSignup: boolean;
}

export interface EntraSettings {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  /** Write-only: send a new value to replace, omit/empty to keep the stored one. */
  clientSecret?: string;
  hasClientSecret?: boolean;
  /** Empty = <APP_URL>/api/auth/entra/callback */
  redirectUri: string;
  syncCron: string;
  /** Set when Trigon created the app registration itself. */
  provisionedAppId?: string | null;
}

export interface LdapSettings {
  enabled: boolean;
  url: string;
  bindDn: string;
  bindPassword?: string;
  hasBindPassword?: boolean;
  searchBase: string;
  userFilter: string;
  syncUserFilter: string;
  groupFilter: string;
  tlsRejectUnauthorized: boolean;
  syncCron: string;
}

export interface AllSettings {
  general: GeneralSettings;
  entra: EntraSettings;
  ldap: LdapSettings;
  /** Read-only facts the settings UI needs. */
  info: { appUrl: string; entraRedirectUri: string; httpsWarning: boolean };
}

export type ProvisionState = 'idle' | 'waiting_for_sign_in' | 'working' | 'done' | 'error';

export interface EntraProvisionStatus {
  state: ProvisionState;
  userCode?: string;
  verificationUri?: string;
  expiresAt?: string;
  steps: { label: string; done: boolean }[];
  message?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: SystemRole;
  active: boolean;
  providers: AuthProvider[];
  groups: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  source: GroupSource;
  members: number;
  lastSyncedAt: string | null;
}

export interface IconInfo {
  id: string;
  name: string;
  domain: string | null;
}

export interface IconCatalogEntry {
  name: string;
  domain: string;
  category: string;
  /** Set once Trigon has fetched and stored the vendor's icon. */
  iconId: string | null;
}

/** Icon column values: an emoji, or `img:<icon id>` for a stored image icon. */
export function iconImageId(icon: string | null | undefined): string | null {
  return icon?.startsWith('img:') ? icon.slice(4) : null;
}

export function fileExtension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** Extensions treated as editable plain text (configs, scripts, source code, notes). */
const TEXT_EXTENSIONS = new Set(
  (
    'txt md markdown log csv tsv json jsonc json5 yaml yml toml ini cfg conf env properties xml html htm css scss less ' +
    'js mjs cjs jsx ts tsx py rb php go rs java kt kts swift c h cpp hpp cc cs fs vb sql sh bash zsh fish ps1 psm1 psd1 bat cmd ' +
    'dockerfile tf tfvars hcl nix lua pl r dart groovy gradle vue svelte graphql gql proto reg service rules nginx htaccess editorconfig gitignore'
  ).split(' '),
);

/** Can this file node be opened in the code editor? */
export function isTextFile(title: string, mimeType: string | null | undefined): boolean {
  if (mimeType?.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/x-yaml') return true;
  const lower = title.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop()! : lower;
  return TEXT_EXTENSIONS.has(ext);
}

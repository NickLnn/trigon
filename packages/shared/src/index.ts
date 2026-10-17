/**
 * Types and constants shared by the API and the web app.
 * Keep this package dependency-free so both sides can import it cheaply.
 */

export const AUTH_PROVIDERS = ['local', 'entra', 'ldap'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const GROUP_SOURCES = ['local', 'entra', 'ldap'] as const;
export type GroupSource = (typeof GROUP_SOURCES)[number];

/**
 * Workspace-wide role — the ceiling on what someone can do anywhere:
 *   admin  — everything, including Settings and every space
 *   editor — can create spaces and edit wherever they've been granted edit
 *   viewer — read-only everywhere, whatever a space grants them
 */
export const SYSTEM_ROLES = ['admin', 'editor', 'viewer'] as const;
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

/** How a space orders its tree: alphabetically, or by hand with drag & drop. */
export const SPACE_SORTS = ['alpha', 'manual'] as const;
export type SpaceSort = (typeof SPACE_SORTS)[number];

export interface SpaceSummary {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  sortMode: SpaceSort;
  myPermission: PermissionLevel;
}

/** What a page is for — drives filter chips and the runbook layout. */
export const PAGE_TYPES = ['page', 'runbook', 'kb'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Review state. "stale" is derived: verified, but older than its review interval. */
export const DOC_STATUSES = ['none', 'draft', 'verified'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export type DisplayStatus = DocStatus | 'stale';

export interface DocumentNode {
  id: string;
  spaceId: string;
  parentId: string | null;
  kind: DocumentKind;
  title: string;
  icon: string | null;
  position: number;
  mimeType: string | null;
  pageType: PageType;
  status: DisplayStatus;
  updatedAt: string;
  children?: DocumentNode[];
}

const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

type Sortable = Pick<DocumentNode, 'title' | 'id' | 'position'>;

/** Alphabetical by title, case-insensitive, with numbers in natural order ("2" before "10"). */
export function compareNodes(a: Sortable, b: Sortable): number {
  return titleCollator.compare(a.title.trim(), b.title.trim()) || a.id.localeCompare(b.id);
}

/** Sibling order for a space's tree: alphabetical, or by drag & drop position (title breaks ties). */
export function treeComparator(mode: SpaceSort): (a: Sortable, b: Sortable) => number {
  return mode === 'manual' ? (a, b) => a.position - b.position || compareNodes(a, b) : compareNodes;
}

export interface HealthStats {
  total: number;
  verified: number;
  stale: number;
  drafts: number;
  /** Fresh verified share of reviewed-or-draft pages, 0–100. */
  score: number;
  needsReview: { id: string; title: string; icon: string | null; spaceId: string; spaceName: string; status: DisplayStatus; since: string }[];
}

/** Activity explorer (audit log) — what people did, grouped like Microsoft Purview's activities. */
export const ACTIVITY_CATEGORIES = ['content', 'sharing', 'spaces', 'access', 'admin'] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  content: 'Pages & files',
  sharing: 'Sharing',
  spaces: 'Spaces',
  access: 'Sign-ins',
  admin: 'Administration',
};

/** `{type}` in a label is replaced by the target type (page, folder, file…). */
export const ACTIVITY_ACTIONS = {
  'item.created': { category: 'content', label: 'Created {type}' },
  'item.imported': { category: 'content', label: 'Imported page' },
  'file.uploaded': { category: 'content', label: 'Uploaded file' },
  'page.edited': { category: 'content', label: 'Edited page' },
  'file.edited': { category: 'content', label: 'Edited file' },
  'item.renamed': { category: 'content', label: 'Renamed {type}' },
  'item.moved': { category: 'content', label: 'Moved {type}' },
  'item.updated': { category: 'content', label: 'Changed {type} properties' },
  'page.verified': { category: 'content', label: 'Verified page' },
  'review.requested': { category: 'content', label: 'Asked for a review of {type}' },
  'review.approved': { category: 'content', label: 'Approved {type} in review' },
  'review.changes_requested': { category: 'content', label: 'Requested changes to {type}' },
  'review.cancelled': { category: 'content', label: 'Cancelled a review request' },
  'version.restored': { category: 'content', label: 'Restored an earlier version of {type}' },
  'item.restored': { category: 'content', label: 'Restored {type} from trash' },
  'item.purged': { category: 'content', label: 'Permanently deleted {type}' },
  'item.deleted': { category: 'content', label: 'Deleted {type}' },
  'comment.added': { category: 'content', label: 'Commented on {type}' },
  'comment.resolved': { category: 'content', label: 'Resolved a comment on {type}' },
  'share.added': { category: 'sharing', label: 'Shared {type}' },
  'share.changed': { category: 'sharing', label: 'Changed access to {type}' },
  'share.removed': { category: 'sharing', label: 'Removed access to {type}' },
  'space.created': { category: 'spaces', label: 'Created space' },
  'space.updated': { category: 'spaces', label: 'Changed space' },
  'space.deleted': { category: 'spaces', label: 'Deleted space' },
  'user.signed_in': { category: 'access', label: 'Signed in' },
  'user.sign_in_failed': { category: 'access', label: 'Failed sign-in' },
  'user.created': { category: 'admin', label: 'Created user' },
  'user.updated': { category: 'admin', label: 'Changed user' },
  'user.password_set': { category: 'admin', label: 'Set password' },
  'group.created': { category: 'admin', label: 'Created group' },
  'group.deleted': { category: 'admin', label: 'Deleted group' },
  'group.member_added': { category: 'admin', label: 'Added group member' },
  'group.member_removed': { category: 'admin', label: 'Removed group member' },
  'settings.updated': { category: 'admin', label: 'Changed settings' },
  'backup.created': { category: 'admin', label: 'Backed up Trigon' },
  'backup.failed': { category: 'admin', label: 'Backup failed' },
  'backup.restored': { category: 'admin', label: 'Restored a backup' },
  'backup.deleted': { category: 'admin', label: 'Deleted a backup' },
  'storage.cleaned': { category: 'admin', label: 'Removed leftover files' },
} as const satisfies Record<string, { category: ActivityCategory; label: string }>;
export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;

export function activityLabel(action: string, targetType: string | null): string {
  const def = ACTIVITY_ACTIONS[action as ActivityAction];
  if (!def) return action;
  return def.label.replace('{type}', targetType ?? 'item');
}

export interface ActivityEvent {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: ActivityAction;
  category: ActivityCategory;
  spaceId: string | null;
  spaceName: string | null;
  /** page | folder | file | space | user | group | settings */
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}

export interface ActivityPage {
  items: ActivityEvent[];
  nextCursor: string | null;
}

export interface SpaceStats {
  docs: number;
  verified: number;
  stale: number;
}

/** A permission as shown in the share dialog — direct or inherited from a parent folder / the space. */
export interface EffectiveGrant {
  id: string;
  subjectType: 'user' | 'group' | 'everyone';
  subjectId: string | null;
  subjectName: string;
  subjectDetail: string | null;
  level: PermissionLevel;
  /** Where the grant lives. */
  resourceType: 'space' | 'document';
  resourceId: string;
  resourceName: string;
  inherited: boolean;
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
  /** Address on the local network, e.g. http://192.168.x.x:8797 (empty = APP_URL). */
  internalUrl: string;
  /** Address people use from anywhere (HTTPS), e.g. https://trigon.example.com — used in emails and for Microsoft sign-in. */
  publicUrl: string;
  /** The first-run "Where does Trigon live?" step was completed or skipped. */
  setupDone: boolean;
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
  /**
   * HTTPS addresses an admin has opened Trigon at (e.g. a Cloudflare / reverse-proxy hostname next to
   * the LAN APP_URL). Trigon keeps <origin>/api/auth/entra/callback registered for each one.
   */
  signInOrigins?: string[];
  /**
   * What directory sync imports: the whole tenant, or only the chosen groups (with their nested
   * members) plus individually chosen users. With 'selected', only synced people can sign in.
   */
  syncScope: 'all' | 'selected';
  syncGroups: DirectoryPick[];
  syncUsers: DirectoryPick[];
  /** The admin chose to send email through Exchange Online: the app holds Graph Mail.Send. */
  mailSend?: boolean;
}

/** Outgoing email (notifications). Secrets are write-only, like the other sections. */
export const EMAIL_PROVIDERS = ['none', 'smtp', 'microsoft'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export interface EmailSettings {
  provider: EmailProvider;
  /** Sender address. For Microsoft 365 this must be a mailbox in the tenant (a shared mailbox works). */
  fromAddress: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  /** tls = implicit TLS (465), starttls = upgrade (587), none = plain (25, LAN relays only). */
  smtpSecurity: 'tls' | 'starttls' | 'none';
  smtpUser: string;
  smtpPassword?: string;
  hasSmtpPassword?: boolean;
  smtpTlsRejectUnauthorized: boolean;
}

/** Which emails a person wants. Missing keys fall back to DEFAULT_NOTIFICATION_PREFS. */
export interface NotificationPrefs {
  /** Something was shared with me (directly or through a group), or my access level changed. */
  shares: boolean;
  /** My account was created, my role changed, I was (de)activated, an admin set my password. */
  account: boolean;
  /** Pages I own that need review or are still drafts. Weekly digests go out on Mondays. */
  reviewDigest: 'off' | 'daily' | 'weekly';
  /** Someone asks me to review something, or answers a review I asked for. */
  reviews: boolean;
  /** New comments and replies on pages I own or discuss, or where I'm part of a review. */
  comments: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { shares: true, account: true, reviewDigest: 'weekly', reviews: true, comments: true };

/** A saved version of a page: one per person per editing session (see VersionsService). */
export interface DocumentVersion {
  id: string;
  /** When the editing session started and when it was last saved. */
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string } | null;
  title: string;
  /** e.g. "Restored the version from 12 Oct 14:02" or "Before history was kept". */
  note: string | null;
  /** Lines added/removed compared with the version before it. */
  added: number;
  removed: number;
  /** The newest version is the page as it is now. */
  current: boolean;
}

export interface DocumentVersionDetail extends DocumentVersion {
  /** ProseMirror JSON of the page at this version. */
  content: Record<string, unknown> | null;
  /** Line diff against the version before it. */
  diff: { added: number; removed: number; lines: { t: ' ' | '+' | '-' | '…'; s: string }[]; truncated: boolean };
}

/** Something deleted from a space, waiting in its trash. */
export interface TrashItem {
  id: string;
  title: string;
  kind: DocumentKind;
  icon: string | null;
  mimeType: string | null;
  pageType: PageType;
  deletedAt: string;
  deletedBy: string | null;
  /** Items inside it (deleted together). */
  inside: number;
  /** Where it was; null at the space root. Restores go back there, or to the root if that is gone too. */
  location: string | null;
  /** When it is removed for good. */
  purgeAt: string;
  spaceId: string;
  spaceName: string;
}

/** "Ask for review": one person asked another to check a page or file. */
export const REVIEW_STATUSES = ['pending', 'approved', 'changes_requested', 'cancelled'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewRequest {
  id: string;
  documentId: string;
  status: ReviewStatus;
  /** What the requester asked for. */
  message: string | null;
  /** The reviewer's note when answering. */
  response: string | null;
  createdAt: string;
  respondedAt: string | null;
  requestedBy: { id: string; name: string } | null;
  reviewer: { id: string; name: string; email: string };
}

/** A pending request addressed to me, with the item it is about. */
export interface MyReviewRequest extends ReviewRequest {
  document: { title: string; kind: DocumentKind; icon: string | null; mimeType: string | null; pageType: PageType; spaceId: string; spaceName: string };
}

export interface MyNotifications {
  prefs: NotificationPrefs;
  /** Where the emails go. */
  email: string;
  /** False until an admin sets up Settings → Email; choices are kept for then. */
  emailEnabled: boolean;
}

/** Whether the Entra app can send mail (Mail.Send granted). */
export interface EmailMicrosoftStatus {
  connected: boolean;
  mailSend: 'granted' | 'missing' | 'unknown';
  message: string | null;
}

/** A group or user chosen in the "who gets access" picker (names kept for display). */
export interface DirectoryPick {
  id: string;
  name: string;
  detail?: string | null;
}

export interface SyncResult {
  source: 'entra' | 'ldap';
  users: number;
  groups: number;
  memberships: number;
  deactivated: number;
  durationMs: number;
}

export interface SyncSourceStatus {
  enabled: boolean;
  running: boolean;
  startedAt: string | null;
  lastResult: (SyncResult & { finishedAt: string }) | null;
  lastError: string | null;
  lastGroupSync: string | null;
  accounts: number;
}

/** Where backups go: a folder on this server, an SMB share, or an NFS export mounted into the container. */
export const BACKUP_DESTINATIONS = ['local', 'smb', 'nfs'] as const;
export type BackupDestination = (typeof BACKUP_DESTINATIONS)[number];

export interface BackupSettings {
  /** Run on the schedule (manual "Back up now" always works). */
  enabled: boolean;
  /** Cron expression, e.g. "0 2 * * *" = every night at 02:00 (server time). */
  schedule: string;
  /** How many backups to keep at the destination; older ones are deleted after each backup. */
  keep: number;
  /** Every backup is copied to each of these (at least one). */
  destinations: BackupDestination[];
  /** Folder inside the container for 'local' (default /data/backups, mapped to ./data/backups). */
  localPath: string;
  /** NFS server and export, used to generate the docker-compose snippet; mounted at /data/backups-nfs. */
  nfsServer: string;
  nfsExport: string;
  smbHost: string;
  smbShare: string;
  /** Folder inside the share (created when missing). */
  smbPath: string;
  smbUser: string;
  smbDomain: string;
  smbPassword?: string;
  hasSmbPassword?: boolean;
  /** Result of the last run (read-only). */
  lastRun?: BackupRunResult | null;
}

export interface BackupRunResult {
  ok: boolean;
  at: string;
  durationMs: number;
  file: string | null;
  sizeBytes: number | null;
  message: string;
  trigger: 'scheduled' | 'manual' | 'before-restore';
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
  trigger: BackupRunResult['trigger'];
  /** Destinations that hold a copy. */
  locations: BackupDestination[];
}

export interface BackupDestinationStatus {
  key: BackupDestination;
  label: string;
  ok: boolean;
  message: string;
  freeBytes: number | null;
  persistent: boolean | null;
}

export interface BackupOverview {
  settings: BackupSettings;
  running: { step: string; startedAt: string; kind: 'backup' | 'restore' } | null;
  nextRun: string | null;
  files: BackupFile[];
  /** Each selected destination: reachable or not, and why. */
  destinations: BackupDestinationStatus[];
  /** docker-compose lines for an NFS destination (filled from nfsServer / nfsExport). */
  nfsCompose: string;
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

// ─── Storage overview (Settings → Storage) ───

export interface StorageOverview {
  /** Where uploaded files and page images are kept. */
  storage: { driver: 'local' | 's3'; location: string };
  /** The disk the files are on (null for S3 or when unknown). */
  disk: { freeBytes: number; totalBytes: number } | null;
  files: { count: number; bytes: number };
  pageImages: { count: number; bytes: number };
  trash: { items: number; bytes: number; purgeDays: number };
  /** Database size; page text and history live here. */
  database: { bytes: number; historyBytes: number; versions: number };
  /** Backups in the "This server" folder (null when that destination isn't used or can't be read). */
  backups: { count: number; bytes: number; location: string } | null;
  largest: { id: string; title: string; mimeType: string | null; spaceName: string; sizeBytes: number }[];
  spaces: { id: string; name: string; bytes: number; files: number }[];
}

/** Stored blobs nothing refers to any more (e.g. an upload interrupted halfway). Only those older than a day count. */
export interface StorageLeftovers {
  count: number;
  bytes: number;
  scannedAt: string;
}

// ─── Comments ───

export const COMMENT_MAX = 5000;

export interface CommentItem {
  id: string;
  body: string;
  author: { id: string; name: string } | null;
  createdAt: string;
  editedAt: string | null;
  /** The viewer may edit it (own comment). */
  canEdit: boolean;
  /** The viewer may delete it (own comment, or manages the page). */
  canDelete: boolean;
}

export interface CommentThread {
  id: string;
  /** Yjs relative positions (base64) of the commented passage; null = about the whole page. */
  anchorFrom: string | null;
  anchorTo: string | null;
  /** The passage as it was when the thread started. */
  quote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  comments: CommentItem[];
}

/** GET /documents/:id/comments */
export interface CommentsResponse {
  threads: CommentThread[];
  /** The viewer may start threads, reply and resolve ('comment' access or more). */
  canComment: boolean;
}

/** One search result (GET /documents/search). */
export interface SearchHit {
  id: string;
  title: string;
  kind: DocumentKind;
  icon: string | null;
  mimeType: string | null;
  pageType: PageType;
  status: DisplayStatus;
  spaceId: string;
  spaceName: string;
  /** Excerpt with matched words wrapped in <mark> (plain text otherwise; escape before rendering). */
  snippet: string;
  updatedAt: string;
  /** Where the words were found: page/file text, OCR of a scan or image file, or an image pasted into the page. Null = title only. */
  foundIn: 'text' | 'scan' | 'image' | null;
  /** For PDFs: the page of the first match. */
  page: number | null;
}

/** Search filters: `type` limits to pages or files, `since` to things changed in the last N days. */
export const SEARCH_SINCE_DAYS = [7, 30, 365] as const;

/** Making uploaded files searchable: text from PDFs / Office files, and OCR for scans and images. */
export interface SearchSettings {
  /** Read text out of scanned PDFs and images (Tesseract). Text-based PDFs and Office files are always indexed. */
  ocrEnabled: boolean;
  /** Tesseract language codes used together, e.g. ["eng", "ell"]. */
  ocrLanguages: string[];
  /** Scanned pages OCR'd per file at most (keeps CPU time bounded on big scans). */
  ocrMaxPages: number;
}

export interface OcrLanguage {
  code: string;
  name: string;
  /** Shipped with Trigon, or added to the data/tessdata folder. */
  source: 'built-in' | 'added';
}

export interface SearchIndexStatus {
  settings: SearchSettings;
  /** OCR tools are present in this container (false when running outside the Docker image). */
  ocrAvailable: boolean;
  languages: OcrLanguage[];
  /** Uploaded files and images pasted into pages, by how their text was obtained. */
  counts: { pending: number; text: number; ocr: number; empty: number; unsupported: number; failed: number };
  /** How many of those are images pasted into pages. */
  pageImages: number;
  /** Title of the file being read right now, if any. */
  current: string | null;
}

export interface AllSettings {
  general: GeneralSettings;
  entra: EntraSettings;
  ldap: LdapSettings;
  email: EmailSettings;
  /** Read-only facts the settings UI needs. */
  info: {
    /** Where Trigon is reached on the LAN. */
    internalUrl: string;
    /** The public HTTPS address, when known (set in General, or learned from an admin's browser). */
    publicUrl: string | null;
    /** The Microsoft sign-in callback for the public address. */
    entraRedirectUri: string;
    /** No public HTTPS address is known yet. */
    httpsWarning: boolean;
    entraSignIn: EntraSignInStatus;
  };
}

/** Whether Trigon's sign-in redirect addresses are registered on the Entra app. */
export interface EntraSignInStatus {
  /** Callback URLs Microsoft must accept (HTTPS or localhost only). */
  redirectUris: string[];
  /** ok = all registered; reconnect = Trigon lacks permission to update its app; none = no HTTPS address yet. */
  state: 'ok' | 'reconnect' | 'none' | 'error' | 'unknown';
  message: string | null;
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
  /** The last attempt found no usable icon (the picker shows a placeholder instead of waiting). */
  failed: boolean;
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

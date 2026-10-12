import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { BackupSettings } from '@trigon/shared';
import { BACKUP_NAME, type Destination, type StoredFile } from './destinations';

/**
 * Google Drive with the narrowest scope there is: drive.file — Trigon sees only the files and folders it
 * created itself, never the rest of the Drive. openid + email only tell us which account was connected.
 */
export const GDRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];
export const GDRIVE_CALLBACK = '/api/backups/gdrive/callback';
const FOLDER = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';

async function googleError(res: Response, what: string): Promise<Error> {
  const text = await res.text();
  let msg = text;
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
    msg = j.error_description ?? (typeof j.error === 'string' ? j.error : j.error?.message) ?? text;
  } catch {
    /* not JSON */
  }
  if (/invalid_grant/.test(text)) {
    return new Error('Google Drive: access was revoked or has expired — connect Google Drive again. (If this happens every 7 days, set the OAuth consent screen\'s publishing status to "In production".)');
  }
  return new Error(`Google Drive: ${what} failed (${res.status}): ${msg}`);
}

export function authUrl(clientId: string, redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GDRIVE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Authorization code → refresh token + the account's email. */
export async function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await googleError(res, 'sign-in');
  const body = (await res.json()) as { refresh_token?: string; access_token: string; id_token?: string };
  if (!body.refresh_token) throw new Error('Google did not return a refresh token. Remove Trigon under myaccount.google.com → Security → Third-party access and connect again.');
  let email: string | null = null;
  try {
    email = (JSON.parse(Buffer.from(body.id_token!.split('.')[1], 'base64url').toString()) as { email?: string }).email ?? null;
  } catch {
    /* no id token */
  }
  return { refreshToken: body.refresh_token, accessToken: body.access_token, email };
}

export async function accessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await googleError(res, 'refreshing access');
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function revoke(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function drive<T>(token: string, path: string, init: RequestInit = {}, what = 'request'): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw await googleError(res, what);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Find the folder Trigon created with this name in My Drive, or create it. */
export async function ensureFolder(token: string, name: string): Promise<string> {
  const search = await drive<{ files: { id: string }[] }>(
    token,
    `/files?${new URLSearchParams({ q: `mimeType='${FOLDER}' and name='${q(name)}' and 'root' in parents and trashed=false`, fields: 'files(id)', spaces: 'drive' })}`,
    {},
    'finding the folder',
  );
  if (search.files[0]) return search.files[0].id;
  const created = await drive<{ id: string }>(
    token,
    '/files?fields=id',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER }) },
    'creating the folder',
  );
  return created.id;
}

export class GoogleDriveDestination implements Destination {
  readonly label: string;
  private token: { value: string; until: number } | null = null;

  constructor(private readonly s: BackupSettings) {
    this.label = `Google Drive${s.gdriveAccount ? ` (${s.gdriveAccount})` : ''} › ${s.gdriveFolderName || 'Trigon Backups'}`;
  }

  private async auth() {
    if (!this.s.gdriveClientId || !this.s.gdriveClientSecret) throw new Error('Google Drive: enter the OAuth client ID and secret, then connect.');
    if (!this.s.gdriveRefreshToken) throw new Error('Google Drive: not connected yet — press "Connect Google Drive".');
    if (!this.s.gdriveFolderId) throw new Error('Google Drive: no folder yet — connect again or save the folder name.');
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const value = await accessToken(this.s.gdriveClientId, this.s.gdriveClientSecret, this.s.gdriveRefreshToken);
    this.token = { value, until: Date.now() + 45 * 60_000 };
    return value;
  }

  private async find(token: string, name: string) {
    const r = await drive<{ files: { id: string }[] }>(
      token,
      `/files?${new URLSearchParams({ q: `name='${q(name)}' and '${this.s.gdriveFolderId}' in parents and trashed=false`, fields: 'files(id)', spaces: 'drive' })}`,
      {},
      'finding the backup',
    );
    if (!r.files[0]) throw new Error(`Google Drive: ${name} is not in the folder.`);
    return r.files[0].id;
  }

  /** Resumable upload, streamed — no size limit beyond the Drive's free space. */
  async put(localFile: string, name: string) {
    const token = await this.auth();
    const size = (await stat(localFile)).size;
    const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': 'application/gzip',
        'x-upload-content-length': String(size),
      },
      body: JSON.stringify({ name, parents: [this.s.gdriveFolderId] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!start.ok) throw await googleError(start, 'starting the upload');
    const session = start.headers.get('location');
    if (!session) throw new Error('Google Drive: no upload session was returned.');
    const upload = await fetch(session, {
      method: 'PUT',
      headers: { 'content-length': String(size), 'content-type': 'application/gzip' },
      body: Readable.toWeb(createReadStream(localFile)) as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!upload.ok) throw await googleError(upload, 'uploading');
  }

  async list(): Promise<StoredFile[]> {
    const token = await this.auth();
    const out: StoredFile[] = [];
    let pageToken: string | undefined;
    do {
      const r = await drive<{ files: { name: string; size?: string }[]; nextPageToken?: string }>(
        token,
        `/files?${new URLSearchParams({
          q: `'${this.s.gdriveFolderId}' in parents and trashed=false`,
          fields: 'nextPageToken, files(name, size)',
          pageSize: '1000',
          spaces: 'drive',
          ...(pageToken ? { pageToken } : {}),
        })}`,
        {},
        'listing backups',
      );
      for (const f of r.files) if (BACKUP_NAME.test(f.name)) out.push({ name: f.name, sizeBytes: Number(f.size ?? 0) });
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async get(name: string, localFile: string) {
    const token = await this.auth();
    const id = await this.find(token, name);
    const res = await fetch(`${API}/files/${id}?alt=media`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) throw await googleError(res, 'downloading');
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(localFile));
  }

  async remove(name: string) {
    const token = await this.auth();
    const id = await this.find(token, name);
    await drive(token, `/files/${id}`, { method: 'DELETE' }, 'deleting');
  }

  async check() {
    const token = await this.auth();
    const folder = await drive<{ trashed?: boolean }>(token, `/files/${this.s.gdriveFolderId}?fields=id,trashed`, {}, 'opening the folder').catch((err: Error) => {
      if (/\(404\)/.test(err.message)) throw new Error('Google Drive: the backup folder was deleted — save the settings again to recreate it.');
      throw err;
    });
    if (folder.trashed) throw new Error('Google Drive: the backup folder is in the Drive trash — restore it or save the settings again to create a new one.');
    let freeBytes: number | null = null;
    try {
      const about = await drive<{ storageQuota?: { limit?: string; usage?: string } }>(token, '/about?fields=storageQuota');
      if (about.storageQuota?.limit) freeBytes = Number(about.storageQuota.limit) - Number(about.storageQuota.usage ?? 0);
    } catch {
      /* quota is optional */
    }
    return { freeBytes, persistent: true };
  }
}


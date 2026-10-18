import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const V1 = 'enc:v1:';
const V2 = 'enc:v2:';

/** v2 key: HKDF-SHA-256 of the master secret, bound to this one purpose. */
function deriveV2(master: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, 'trigon', 'settings-secrets/v2', 32));
}

/** v1 key (before HKDF): a single SHA-256 of the master secret. Only used to read old values. */
function deriveV1(master: string): Buffer {
  return createHash('sha256').update(`trigon-settings:${master}`).digest();
}

function open(key: Buffer, iv: string, tag: string, data: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * AES-256-GCM for secrets stored in the database (Entra client secret, LDAP bind password, SMTP and SMB
 * passwords). New values are written as `enc:v2:<iv>:<tag>:<data>` with a key derived from `master`;
 * `previous` masters (key rotation) and the legacy v1 format can still be read, so stored values are
 * re-encrypted under the current key instead of being lost.
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly readKeys: { v1: Buffer[]; v2: Buffer[] };

  constructor(master: string, previous: string[] = []) {
    if (!master) throw new Error('SecretBox needs a master key');
    this.key = deriveV2(master);
    const all = [master, ...previous.filter(Boolean)];
    this.readKeys = { v1: all.map(deriveV1), v2: all.map(deriveV2) };
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${V2}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
  }

  /** Plain text of a stored value; null when no known key opens it. Unencrypted values come back as they are. */
  decrypt(value: string): string | null {
    const version = value.startsWith(V2) ? 'v2' : value.startsWith(V1) ? 'v1' : null;
    if (!version) return value;
    const [, , iv, tag, data] = value.split(':');
    for (const key of this.readKeys[version]) {
      try {
        return open(key, iv, tag, data);
      } catch {
        /* try the next key */
      }
    }
    return null;
  }

  /** Whether a stored value should be rewritten: plain text, the old format, or a previous key. */
  needsReencrypt(value: string): boolean {
    if (!value) return false;
    if (!value.startsWith(V2)) return true;
    const [, , iv, tag, data] = value.split(':');
    try {
      open(this.key, iv, tag, data);
      return false;
    } catch {
      return true;
    }
  }
}

/**
 * The secret a "Test connection" form may use. A typed-in secret always works; an empty field means
 * "use the stored one", but only when every field that decides where the secret is sent (server, port,
 * user, TLS) still matches what is saved. Otherwise null: an admin session must not be able to point
 * the stored password at another server and read it there.
 */
export function storedSecretFor<T extends object>(form: T, stored: T, secret: keyof T, binding: (keyof T)[]): string | null {
  const typed = form[secret];
  if (typeof typed === 'string' && typed) return typed;
  const unchanged = binding.every((k) => String(form[k] ?? '').trim().toLowerCase() === String(stored[k] ?? '').trim().toLowerCase());
  return unchanged ? String(stored[secret] ?? '') : null;
}

/** Replace secret fields with `has<Field>` flags, so a settings section can be sent to the browser. */
export function maskSecrets<T extends object>(section: T, fields: readonly string[]): T {
  const out = { ...section } as Record<string, unknown>;
  for (const f of fields) {
    out[`has${f[0].toUpperCase()}${f.slice(1)}`] = !!out[f];
    delete out[f];
  }
  return out as T;
}

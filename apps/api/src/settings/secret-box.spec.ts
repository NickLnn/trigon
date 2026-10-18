import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { maskSecrets, SecretBox, storedSecretFor } from './secret-box';
import { SECRET_FIELDS } from './settings.service';

const MASTER = 'k'.repeat(16) + randomBytes(24).toString('base64url');

/** A value in the pre-HKDF format, as older versions stored it. */
function legacyV1(master: string, plain: string) {
  const key = createHash('sha256').update(`trigon-settings:${master}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

test('secrets are AES-256-GCM encrypted with a fresh IV and round-trip', () => {
  const box = new SecretBox(MASTER);
  const a = box.encrypt('hunter2-bind-password');
  const b = box.encrypt('hunter2-bind-password');
  assert.match(a, /^enc:v2:[^:]+:[^:]+:[^:]+$/);
  assert.notEqual(a, b, 'same plain text must not give the same cipher text');
  assert.ok(!a.includes('hunter2'));
  assert.equal(box.decrypt(a), 'hunter2-bind-password');
  assert.equal(box.needsReencrypt(a), false);
});

test('tampered or foreign cipher text is rejected, not returned', () => {
  const box = new SecretBox(MASTER);
  const value = box.encrypt('smtp-password');
  const [p, v, iv, tag, data] = value.split(':');
  const flipped = Buffer.from(data, 'base64');
  flipped[0] ^= 1;
  assert.equal(box.decrypt([p, v, iv, tag, flipped.toString('base64')].join(':')), null);
  assert.equal(new SecretBox('another-master-key-that-is-long-enough-123').decrypt(value), null);
});

test('legacy v1 values and previous keys are still readable and flagged for re-encryption', () => {
  const oldJwt = 'old-jwt-secret-0123456789abcdefghijklmnop';
  const v1 = legacyV1(oldJwt, 'entra-client-secret');
  const box = new SecretBox(MASTER, [oldJwt]);
  assert.equal(box.decrypt(v1), 'entra-client-secret');
  assert.equal(box.needsReencrypt(v1), true);

  const underOld = new SecretBox(oldJwt).encrypt('rotated');
  assert.equal(box.decrypt(underOld), 'rotated');
  assert.equal(box.needsReencrypt(underOld), true);
  assert.equal(box.needsReencrypt('plain-text-from-env'), true);
  assert.equal(box.needsReencrypt(''), false);
});

test('every third-party secret is a protected field', () => {
  assert.deepEqual(SECRET_FIELDS.entra, ['clientSecret']);
  assert.deepEqual(SECRET_FIELDS.ldap, ['bindPassword']);
  assert.deepEqual(SECRET_FIELDS.email, ['smtpPassword']);
  assert.deepEqual(SECRET_FIELDS.backup, ['smbPassword']);
});

test('sections sent to the browser carry has* flags instead of secrets', () => {
  const masked = maskSecrets({ url: 'ldaps://dc', bindPassword: 's3cret', bindDn: 'cn=svc' }, SECRET_FIELDS.ldap as string[]);
  assert.deepEqual(masked, { url: 'ldaps://dc', bindDn: 'cn=svc', hasBindPassword: true });
  assert.ok(!JSON.stringify(masked).includes('s3cret'));
  assert.deepEqual(maskSecrets({ smtpPassword: '' }, ['smtpPassword']), { hasSmtpPassword: false });
});

test('"Test connection" reuses a stored secret only for the saved server and user', () => {
  const stored = { url: 'ldaps://dc01.example.local:636', bindDn: 'CN=svc', bindPassword: 'stored-pw', tlsRejectUnauthorized: true };
  const same = { ...stored, bindPassword: '' };
  assert.equal(storedSecretFor(same, stored, 'bindPassword', ['url', 'bindDn', 'tlsRejectUnauthorized']), 'stored-pw');
  assert.equal(storedSecretFor({ ...same, url: ' LDAPS://DC01.example.local:636 ' }, stored, 'bindPassword', ['url', 'bindDn']), 'stored-pw');
  // Pointing the stored password at another server (or user, or without TLS checks) is refused.
  assert.equal(storedSecretFor({ ...same, url: 'ldap://attacker.example:389' }, stored, 'bindPassword', ['url', 'bindDn', 'tlsRejectUnauthorized']), null);
  assert.equal(storedSecretFor({ ...same, bindDn: 'CN=other' }, stored, 'bindPassword', ['url', 'bindDn']), null);
  assert.equal(storedSecretFor({ ...same, tlsRejectUnauthorized: false }, stored, 'bindPassword', ['url', 'tlsRejectUnauthorized']), null);
  // A typed-in secret is always the one used.
  assert.equal(storedSecretFor({ ...same, url: 'ldap://elsewhere', bindPassword: 'typed' }, stored, 'bindPassword', ['url']), 'typed');
});

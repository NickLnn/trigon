import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact, REDACTED, settingsChanges } from './redact';

test('secrets never reach the audit log, however deeply they are nested', () => {
  const out = redact({
    method: 'Domain (LDAP)',
    password: 'hunter2',
    nested: { smtpPassword: 'p', clientSecret: 's', accessToken: 't', Authorization: 'Bearer x', apiKey: 'k', cookie: 'c' },
    list: [{ refresh_token: 'r' }],
    hasBindPassword: true,
    reason: 'Invalid domain credentials',
  }) as Record<string, unknown>;
  const text = JSON.stringify(out);
  for (const secret of ['hunter2', '"p"', '"s"', '"t"', 'Bearer x', '"k"', '"c"', '"r"']) assert.ok(!text.includes(secret), secret);
  assert.equal(out.password, REDACTED);
  assert.equal(out.hasBindPassword, true, 'has* flags are booleans and stay readable');
  assert.equal(out.method, 'Domain (LDAP)');
});

test('long strings are cut and deep structures bounded', () => {
  assert.equal((redact('x'.repeat(10_000)) as string).length, 4001);
  let deep: Record<string, unknown> = { v: 1 };
  for (let i = 0; i < 20; i++) deep = { deep };
  assert.ok(JSON.stringify(redact(deep)).includes('[…]'));
});

test('settings changes are audited as old → new, with secrets only marked as changed', () => {
  const before = { url: 'ldaps://dc01:636', bindDn: 'CN=svc', bindPassword: 'old-secret', tlsRejectUnauthorized: true, lastRun: 1 };
  const after = { url: 'ldap://dc01:389', bindDn: 'CN=svc', bindPassword: 'new-secret', tlsRejectUnauthorized: false, lastRun: 2 };
  const changes = settingsChanges(before, after, ['bindPassword'], ['lastRun']);
  assert.deepEqual(changes, {
    url: { from: 'ldaps://dc01:636', to: 'ldap://dc01:389' },
    bindPassword: 'changed',
    tlsRejectUnauthorized: { from: true, to: false },
  });
  assert.ok(!JSON.stringify(changes).includes('secret'));
  assert.deepEqual(settingsChanges({ smtpPassword: 'x' }, { smtpPassword: '' }, ['smtpPassword']), { smtpPassword: 'cleared' });
  assert.deepEqual(settingsChanges({ a: [1] }, { a: [1] }, []), {});
});

test('a redacted settings diff still says which secret changed', () => {
  const details = redact({ changes: settingsChanges({ bindPassword: 'a' }, { bindPassword: 'b' }, ['bindPassword']) });
  assert.deepEqual(details, { changes: { bindPassword: 'changed' } });
});

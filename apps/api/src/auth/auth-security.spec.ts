import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { validateEnv, weakSecretReason } from '../common/env';
import { escapeLdapFilter, validLdapUsername } from '../directory/ldap.service';
import { assertEntraTarget } from '../settings/settings.controller';
import { effectiveActive, isProtected } from '../users/identity.service';
import { sameState, tenantMatches, validTenantId } from './entra-auth.service';
import { BASE_LOCK_MS, FREE_FAILURES, LoginAttemptsService, MAX_LOCK_MS } from './login-attempts.service';

const STRONG = 'Zq8x3VtL0pNw7RfHc2YbKd9MjE4sGa1uTn6WoXi5';
const TENANT = '0f1e2d3c-4b5a-6978-8a9b-acbdcedf0102';

test('the JWT secret fails fast when missing, short or a placeholder', () => {
  assert.equal(weakSecretReason(STRONG), null);
  assert.match(weakSecretReason(undefined)!, /not set/);
  assert.match(weakSecretReason('')!, /not set/);
  assert.match(weakSecretReason('short-secret')!, /shorter/);
  assert.match(weakSecretReason('change-me-change-me-change-me-change-me')!, /placeholder/);
  assert.match(weakSecretReason('a'.repeat(64))!, /variety/);
  assert.throws(() => validateEnv({}), /JWT_ACCESS_SECRET is not set/);
  assert.throws(() => validateEnv({ JWT_ACCESS_SECRET: 'secret' }), /JWT_ACCESS_SECRET/);
  assert.throws(() => validateEnv({ JWT_ACCESS_SECRET: STRONG, SETTINGS_ENCRYPTION_KEY: STRONG }), /must differ/);
  assert.throws(() => validateEnv({ JWT_ACCESS_SECRET: STRONG, SETTINGS_ENCRYPTION_KEY: 'weak' }), /SETTINGS_ENCRYPTION_KEY/);
  assert.doesNotThrow(() => validateEnv({ JWT_ACCESS_SECRET: STRONG }));
  // The sample database password is refused in production, allowed for local development.
  assert.throws(() => validateEnv({ JWT_ACCESS_SECRET: STRONG, NODE_ENV: 'production', PGPASSWORD: 'change-me' }), /change-me/);
  assert.throws(() => validateEnv({ JWT_ACCESS_SECRET: STRONG, NODE_ENV: 'production', DATABASE_URL: 'postgres://trigon:change-me@db:5432/trigon' }), /change-me/);
  assert.doesNotThrow(() => validateEnv({ JWT_ACCESS_SECRET: STRONG, DATABASE_URL: 'postgres://trigon:change-me@localhost:5432/trigon' }));
  assert.doesNotThrow(() => validateEnv({ JWT_ACCESS_SECRET: STRONG, NODE_ENV: 'production', PGPASSWORD: 'x7Gq2-long-random' }));
});

test('tokens signed with another algorithm or key are rejected', async () => {
  const jwt = new JwtService({ secret: STRONG, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } });
  const good = await jwt.signAsync({ sub: 'u1', typ: 'access' });
  assert.equal((await jwt.verifyAsync(good)).sub, 'u1');
  const [h, p] = good.split('.');
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
  await assert.rejects(jwt.verifyAsync(none));
  const hs512 = await new JwtService({ secret: STRONG }).signAsync({ sub: 'u1' }, { algorithm: 'HS512' });
  await assert.rejects(jwt.verifyAsync(hs512));
  await assert.rejects(new JwtService({ secret: STRONG.split('').reverse().join('') }).verifyAsync(good));
  assert.ok(h);
});

test('failed sign-ins pause the account with a growing delay, from any IP', () => {
  const attempts = new LoginAttemptsService();
  let now = 1_000_000;
  attempts.now = () => now;
  const key = LoginAttemptsService.key('local', '  Admin@Example.com ');
  assert.equal(key, LoginAttemptsService.key('local', 'admin@example.com'));

  for (let i = 1; i < FREE_FAILURES; i++) assert.equal(attempts.fail(key), false);
  assert.doesNotThrow(() => attempts.assertAllowed(key));
  assert.equal(attempts.fail(key), true);
  assert.equal(attempts.retryAfter(key), BASE_LOCK_MS);
  assert.throws(
    () => attempts.assertAllowed(key),
    (e: unknown) => e instanceof HttpException && e.getStatus() === 429,
  );
  attempts.fail(key);
  assert.equal(attempts.retryAfter(key), BASE_LOCK_MS * 2);
  for (let i = 0; i < 20; i++) attempts.fail(key);
  assert.equal(attempts.retryAfter(key), MAX_LOCK_MS);

  now += MAX_LOCK_MS;
  assert.doesNotThrow(() => attempts.assertAllowed(key));
  attempts.succeed(key);
  assert.equal(attempts.fail(key), false, 'a successful sign-in clears the history');
  assert.notEqual(LoginAttemptsService.key('ldap', 'admin@example.com'), key);
});

test('LDAP filter values are escaped (RFC 4515) and login names are bounded', () => {
  assert.equal(escapeLdapFilter('*)(objectClass=*'), '\\2a\\29\\28objectClass=\\2a');
  assert.equal(escapeLdapFilter('admin)(|(uid=*'), 'admin\\29\\28|\\28uid=\\2a');
  assert.equal(escapeLdapFilter('a\\b\0c'), 'a\\5cb\\00c');
  assert.equal(escapeLdapFilter('jane.doe@example.com'), 'jane.doe@example.com');
  const filter = '(&(objectClass=user)(sAMAccountName={{username}}))'.replaceAll('{{username}}', escapeLdapFilter('x)(cn=*'));
  assert.equal(filter, '(&(objectClass=user)(sAMAccountName=x\\29\\28cn=\\2a))');
  assert.ok(validLdapUsername('jane.doe'));
  assert.ok(!validLdapUsername(''));
  assert.ok(!validLdapUsername('a'.repeat(257)));
  assert.ok(!validLdapUsername('jane\r\nmail=x'));
});

test('Microsoft sign-in is single-tenant and its state is compared strictly', () => {
  assert.ok(validTenantId(TENANT));
  assert.ok(validTenantId('contoso.onmicrosoft.com'));
  for (const bad of ['common', 'organizations', 'consumers', 'COMMON', '', 'contoso', 'a/../b']) assert.ok(!validTenantId(bad), bad);

  assert.ok(tenantMatches(TENANT, TENANT.toUpperCase()));
  assert.ok(!tenantMatches(TENANT, '11111111-2222-3333-4444-555555555555'));
  assert.ok(!tenantMatches(TENANT, undefined));
  assert.ok(!tenantMatches('common', TENANT));
  assert.ok(tenantMatches('contoso.onmicrosoft.com', TENANT));

  assert.ok(sameState('abc-123', 'abc-123'));
  assert.ok(!sameState('abc-123', 'abc-124'));
  assert.ok(!sameState('abc', 'abc-123'));
  assert.ok(!sameState(undefined, undefined));
  assert.ok(!sameState('', ''));
});

test('a pinned Entra redirect URI must be our HTTPS callback', () => {
  const ok = { enabled: true, tenantId: TENANT, redirectUri: '' };
  assert.doesNotThrow(() => assertEntraTarget(ok));
  assert.doesNotThrow(() => assertEntraTarget({ ...ok, redirectUri: 'https://wiki.example.com/api/auth/entra/callback' }));
  assert.doesNotThrow(() => assertEntraTarget({ ...ok, redirectUri: 'http://localhost:3000/api/auth/entra/callback' }));
  assert.doesNotThrow(() => assertEntraTarget({ enabled: false, tenantId: '', redirectUri: '' }));
  for (const redirectUri of [
    'http://wiki.example.com/api/auth/entra/callback',
    'https://evil.example/collect',
    'https://wiki.example.com/api/auth/entra/callback?next=//evil',
    'javascript:alert(1)',
    'not a url',
  ]) {
    assert.throws(() => assertEntraTarget({ ...ok, redirectUri }), /redirect URI/, redirectUri);
  }
  assert.throws(() => assertEntraTarget({ ...ok, tenantId: 'common' }), /tenant/);
});

test('directory identities never take over protected accounts or undo an admin’s deactivation', () => {
  assert.ok(isProtected({ role: 'admin' }, false));
  assert.ok(isProtected({ role: 'editor' }, true));
  assert.ok(!isProtected({ role: 'editor' }, false));

  assert.equal(effectiveActive(true, { disabledByAdmin: true }), false);
  assert.equal(effectiveActive(true, { disabledByAdmin: false }), true);
  assert.equal(effectiveActive(false, { disabledByAdmin: false }), false);
  assert.equal(effectiveActive(true, undefined), true);
});

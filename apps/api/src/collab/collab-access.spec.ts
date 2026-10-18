import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { STATUS_TTL_MS, UserStatusService, type UserStatus } from '../auth/user-status.service';
import { collabAccess } from './collab-access';

const active = (role: UserStatus['role']): UserStatus => ({ active: true, role });

test('live editing: write needs edit, read needs view, and inactive accounts get nothing', () => {
  assert.equal(collabAccess(active('editor'), 'edit'), 'write');
  assert.equal(collabAccess(active('editor'), 'manage'), 'write');
  assert.equal(collabAccess(active('editor'), 'comment'), 'read');
  assert.equal(collabAccess(active('viewer'), 'view'), 'read');
  assert.equal(collabAccess(active('editor'), null), 'none', 'share revoked or page deleted');
  assert.equal(collabAccess({ active: false, role: 'admin' }, 'manage'), 'none', 'deactivated');
  assert.equal(collabAccess(null, 'manage'), 'none', 'user deleted');
});

function statusService(initial: UserStatus | null) {
  const svc = new UserStatusService(undefined as never);
  let now = 0;
  let current = initial;
  let loads = 0;
  svc.now = () => now;
  svc.load = async () => {
    loads++;
    return current;
  };
  return {
    svc,
    set: (s: UserStatus | null) => (current = s),
    tick: (ms: number) => (now += ms),
    loads: () => loads,
  };
}

const strategy = (svc: UserStatusService) =>
  new JwtStrategy({ getOrThrow: () => 'Zq8x3VtL0pNw7RfHc2YbKd9MjE4sGa1uTn6WoXi5' } as never, svc);
const token = { sub: 'u1', email: 'a@example.com', role: 'admin' as const, typ: 'access' as const };

test('a still-valid access token stops working once the account is deactivated', async () => {
  const s = statusService(active('editor'));
  const jwt = strategy(s.svc);
  assert.equal((await jwt.validate(token)).id, 'u1');
  s.set({ active: false, role: 'editor' });
  s.svc.invalidate('u1'); // what the admin controller does on deactivation
  await assert.rejects(jwt.validate(token), UnauthorizedException);
});

test('the role comes from the database, not from the token', async () => {
  const s = statusService(active('viewer'));
  const user = await strategy(s.svc).validate(token); // token still says admin
  assert.equal(user.role, 'viewer');
});

test('status lookups are cached briefly, then refreshed (changes apply within the TTL even without invalidation)', async () => {
  const s = statusService(active('admin'));
  await s.svc.get('u1');
  await s.svc.get('u1');
  assert.equal(s.loads(), 1);
  s.set(active('viewer'));
  s.tick(STATUS_TTL_MS);
  assert.equal((await s.svc.get('u1'))?.role, 'viewer');
  assert.equal(s.loads(), 2);
});

test('collab and other non-access tokens are not accepted for HTTP requests', async () => {
  const s = statusService(active('admin'));
  await assert.rejects(strategy(s.svc).validate({ ...token, typ: 'collab' }), UnauthorizedException);
});

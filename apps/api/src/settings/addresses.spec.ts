import assert from 'node:assert/strict';
import { test } from 'node:test';
import { originOf } from './settings.controller';
import { SettingsService } from './settings.service';

test('addresses are reduced to scheme://host[:port]', () => {
  assert.equal(originOf('https://trigon.example.com/settings/backups', 'publicUrl'), 'https://trigon.example.com');
  assert.equal(originOf('trigon.example.com', 'publicUrl'), 'https://trigon.example.com');
  assert.equal(originOf('192.168.xxx.xxx:8797', 'internalUrl'), 'http://192.168.xxx.xxx:8797');
  assert.equal(originOf('  ', 'publicUrl'), '');
  assert.equal(originOf(undefined, 'publicUrl'), undefined);
  assert.throws(() => originOf('ftp://nas', 'internalUrl'));
});

/** SettingsService with in-memory sections (no database). */
function service(general: Record<string, unknown>, signInOrigins: string[] = []) {
  const config = { get: (k: string) => ({ APP_URL: 'http://192.168.xxx.xxx:8797', JWT_ACCESS_SECRET: 'x' } as Record<string, string>)[k], getOrThrow: () => 'x' };
  const s = new SettingsService({} as never, config as never);
  (s as unknown as { get: (k: string) => Promise<unknown> }).get = async (k: string) =>
    k === 'general' ? { allowLocalSignup: true, internalUrl: '', publicUrl: '', setupDone: false, ...general } : { signInOrigins };
  return s;
}

test('the public address: set in General, else learned from an admin on HTTPS, else the internal one', async () => {
  assert.equal(await service({ publicUrl: 'https://trigon.example.com' }).publicUrl(), 'https://trigon.example.com');
  assert.equal(await service({}, ['https://learned.example.com']).publicUrl(), 'https://learned.example.com');
  assert.equal(await service({}).publicUrl(), 'http://192.168.xxx.xxx:8797');
  assert.equal(await service({}).knownPublicUrl(), null);
  assert.equal(await service({ internalUrl: 'http://nas.lan:8797' }).internalUrl(), 'http://nas.lan:8797');
});

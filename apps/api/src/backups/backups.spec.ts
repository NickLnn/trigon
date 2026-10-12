import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBackupName } from './backup.service';
import { BACKUP_NAME, nfsCompose } from './destinations';

test('backup file names carry the time and what triggered them', () => {
  assert.deepEqual(parseBackupName('trigon-backup-2026-10-12_020000-scheduled.tar.gz'), {
    name: 'trigon-backup-2026-10-12_020000-scheduled.tar.gz',
    createdAt: '2026-10-12T02:00:00.000Z',
    trigger: 'scheduled',
  });
  assert.equal(parseBackupName('trigon-backup-2026-10-12_020000-before-restore.tar.gz')?.trigger, 'before-restore');
});

test('only our own archives are listed, restored or deleted', () => {
  for (const bad of ['../etc/passwd', 'trigon-backup-2026-10-12_020000-scheduled.tar.gz/../x', 'notes.txt', 'trigon-backup-2026-10-12_020000-other.tar.gz']) {
    assert.equal(BACKUP_NAME.test(bad), false, bad);
    assert.equal(parseBackupName(bad), null);
  }
});

test('NFS compose snippet uses the server and export', () => {
  const s = nfsCompose('nas.example', '/volume1/backups/trigon');
  assert.ok(s.includes('addr=nas.example'));
  assert.ok(s.includes('device: ":/volume1/backups/trigon"'));
  assert.ok(s.includes('trigon-backups-nfs:/data/backups-nfs'));
});

test('SMB share names are cleaned up from whatever was typed or pasted', async () => {
  const { normalizeSmb } = await import('./destinations');
  const base = { smbHost: '192.168.xxx.xxx', smbShare: '', smbPath: 'trigon' } as never as Parameters<typeof normalizeSmb>[0];
  const pick = (s: ReturnType<typeof normalizeSmb>) => [s.smbHost, s.smbShare, s.smbPath];
  assert.deepEqual(pick(normalizeSmb({ ...base, smbShare: '/Nickology Backup' })), ['192.168.xxx.xxx', 'Nickology Backup', 'trigon']);
  assert.deepEqual(pick(normalizeSmb({ ...base, smbShare: String.raw`\\192.168.xxx.xxx\Nickology Backup\Trigon`, smbPath: '' })), ['192.168.xxx.xxx', 'Nickology Backup', 'Trigon']);
  assert.deepEqual(pick(normalizeSmb({ ...base, smbHost: 'smb://nas.local/Backups/trigon', smbShare: '', smbPath: '' })), ['nas.local', 'Backups', 'trigon']);
  assert.deepEqual(pick(normalizeSmb({ ...base, smbShare: 'Backups/nightly', smbPath: 'trigon' })), ['192.168.xxx.xxx', 'Backups', 'nightly/trigon']);
});

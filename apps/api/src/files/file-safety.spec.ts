import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { archiveProblem } from '../backups/backup.service';
import { isGraphUrl } from '../directory/entra-client.service';
import { langArg } from '../search/tools';
import { sniffImage } from './sniff';
import { blobsIn, blobPath, LocalStore } from './storage-drivers';

const KEY = '0f1e2d3c-4b5a-4978-8a9b-acbdcedf0102';

test('image types come from the bytes, not from what the uploader claimed', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  assert.equal(sniffImage(png), 'image/png');
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('GIF89a....')), 'image/gif');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'image/webp');
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"/>')), 'image/svg+xml');
  // HTML or script labelled image/png by the browser is not an image.
  for (const fake of ['<html><script>alert(1)</script>', '<!DOCTYPE html><svg onload=alert(1)>', 'alert(document.cookie)', '%PDF-1.7']) {
    assert.equal(sniffImage(Buffer.from(fake)), null, fake);
  }
});

test('backup archives are listed and checked before extraction (no tar slip, no links)', () => {
  const v = (n: number, t = '-') => Array.from({ length: n }, () => `${t}rw-r--r-- node/node 1 2026-10-12 02:00 x`);
  const good = ['manifest.json', 'database.dump', 'storage/', 'storage/0f/', `storage/0f/${KEY}`];
  assert.equal(archiveProblem(good, [...v(2), 'drwxr-xr-x x', 'drwxr-xr-x x', v(1)[0]]), null);
  for (const evil of ['../../etc/cron.d/x', '/etc/passwd', 'storage/../../app/dist/main.js', `storage/aa/${KEY}`, 'storage/0f/evil.sh', 'manifest.json.bak']) {
    assert.match(archiveProblem([...good, evil], v(6))!, /Unexpected file/, evil);
  }
  const symlinked = [...v(4), `lrwxrwxrwx node/node 0 2026-10-12 02:00 storage/0f/${KEY} -> /proc/self/environ`];
  assert.match(archiveProblem(good, symlinked)!, /link/);
  assert.match(archiveProblem(good, [...v(4), 'hrw-r--r-- x'])!, /link/);
  assert.match(archiveProblem(['storage/'], v(1, 'd'))!, /not a Trigon backup/);
  assert.match(archiveProblem([], [])!, /empty/);
});

test('restoring files copies only real blob files into the store', async () => {
  const work = await mkdtemp(join(tmpdir(), 'trigon-test-'));
  try {
    const src = join(work, 'storage');
    await mkdir(join(src, '0f'), { recursive: true });
    await writeFile(join(src, '0f', KEY), 'blob');
    assert.deepEqual((await blobsIn(src)).map((b) => b.key), [KEY]);
    const store = new LocalStore(join(work, 'live'));
    await store.importDir(src);
    assert.equal((await store.read(KEY)).toString(), 'blob');

    await writeFile(join(src, '0f', 'notes.txt'), 'x');
    await assert.rejects(blobsIn(src), /Unexpected entry/);
    await rm(join(src, '0f', 'notes.txt'));

    const linked = '0f1e2d3c-4b5a-4978-8a9b-acbdcedf0103';
    const made = await symlink(join(work, 'secret'), join(src, '0f', linked)).then(() => true, () => false);
    if (made) await assert.rejects(blobsIn(src), /Unexpected entry/); // symlinks need extra rights on Windows
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  assert.throws(() => blobPath('../../etc/passwd'), /Invalid storage key/);
});

test('OCR language codes cannot become extra command-line options', () => {
  assert.equal(langArg(['ell', 'eng']), 'ell+eng');
  assert.equal(langArg(['chi_sim', 'deu']), 'chi_sim+deu');
  assert.equal(langArg(['--tessdata-dir=/tmp', 'eng; rm -rf /', '../x']), 'eng');
  assert.equal(langArg([]), 'eng');
});

test('the Graph app token is only sent to Microsoft Graph over HTTPS', () => {
  assert.ok(isGraphUrl('https://graph.microsoft.com/v1.0/users?$skiptoken=abc'));
  for (const bad of ['http://graph.microsoft.com/v1.0/users', 'https://graph.microsoft.com.evil.example/x', 'https://evil.example/graph.microsoft.com', 'https://user:pw@graph.microsoft.com/x', 'nope']) {
    assert.ok(!isGraphUrl(bad), bad);
  }
});

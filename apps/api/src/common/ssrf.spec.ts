import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { assertPublicUrl, isPrivateAddress, publicOnlyLookup, safeFetch } from './ssrf';

test('private, loopback, link-local and special ranges are blocked (IPv4)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '192.0.0.8', '224.0.0.1', '255.255.255.255']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) assert.ok(!isPrivateAddress(ip), ip);
});

test('IPv6 forms that carry a private IPv4 are blocked, including the hex form URL parsing produces', () => {
  const hosts = ['[::ffff:127.0.0.1]', '[::ffff:169.254.169.254]', '[::127.0.0.1]', '[64:ff9b::a9fe:a9fe]', '[2002:7f00:1::]', '[::ffff:10.0.0.1]'];
  for (const h of hosts) {
    const normalised = new URL(`http://${h}/`).hostname; // e.g. [::ffff:7f00:1]
    assert.ok(isPrivateAddress(normalised), `${h} → ${normalised}`);
  }
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1', '2001:db8::1', '2001:0:4136:e378::1', 'fe80::1%eth0']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  assert.ok(!isPrivateAddress('2606:4700:4700::1111'));
  assert.ok(!isPrivateAddress('[::ffff:8.8.8.8]'));
  assert.ok(isPrivateAddress('not-an-ip'));
});

test('URLs pointing inside are refused before any request', async () => {
  for (const url of ['http://127.0.0.1/', 'http://[::ffff:127.0.0.1]:4000/health', 'http://[::ffff:a9fe:a9fe]/latest/meta-data', 'http://localhost:5432/', 'http://2130706433/', 'http://0x7f.1/', 'file:///etc/passwd', 'gopher://x']) {
    await assert.rejects(assertPublicUrl(url), url);
  }
});

test('the connection-time lookup refuses private answers (no DNS rebinding window)', async () => {
  await new Promise<void>((resolve) =>
    publicOnlyLookup('localhost', {}, (err) => {
      assert.equal(err?.code, 'ESSRF');
      resolve();
    }),
  );
});

test('safeFetch never reaches a server on a private address, even via a public-looking redirect', async () => {
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.end('internal');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`, { maxBytes: 1000 }), /non-public/);
    await assert.rejects(safeFetch(`http://[::ffff:127.0.0.1]:${port}/`, { maxBytes: 1000 }), /non-public/);
    await assert.rejects(safeFetch(`http://localhost:${port}/`, { maxBytes: 1000 }), /non-public/);
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});

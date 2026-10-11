import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redirectAllowed, requestOrigin } from './entra-redirect.service';

const req = (headers: Record<string, string>, protocol = 'http') => ({ headers, protocol }) as Parameters<typeof requestOrigin>[0];

test('reads the public origin through Cloudflare and the Next.js rewrite', () => {
  assert.equal(
    requestOrigin(req({ host: 'api:4000', 'x-forwarded-host': 'wiki.example.com', 'x-forwarded-proto': 'https' })),
    'https://wiki.example.com',
  );
  // Proxies that append to the header: the first (client-facing) value wins.
  assert.equal(
    requestOrigin(req({ host: 'api:4000', 'x-forwarded-host': 'Wiki.Example.com:443, web:3000', 'x-forwarded-proto': 'https,http' })),
    'https://wiki.example.com',
  );
  assert.equal(
    requestOrigin(req({ host: 'api:4000', 'x-forwarded-host': 'wiki.example.com', 'x-forwarded-proto': 'http', 'cf-visitor': '{"scheme":"https"}' })),
    'https://wiki.example.com',
  );
  assert.equal(requestOrigin(req({ host: '192.168.xxx.xxx:8797' })), 'http://192.168.xxx.xxx:8797');
});

test('rejects malformed hosts and protocols', () => {
  assert.equal(requestOrigin(req({ host: 'evil.com/path' })), null);
  assert.equal(requestOrigin(req({ host: 'a@evil.com' })), null);
  assert.equal(requestOrigin(req({ host: 'wiki.example.com', 'x-forwarded-proto': 'javascript' })), null);
  assert.equal(requestOrigin(req({})), null);
});

test('only HTTPS and localhost redirects are allowed by Microsoft', () => {
  assert.ok(redirectAllowed('https://wiki.example.com/api/auth/entra/callback'));
  assert.ok(redirectAllowed('http://localhost:3000/api/auth/entra/callback'));
  assert.ok(!redirectAllowed('http://192.168.xxx.xxx:8797/api/auth/entra/callback'));
  assert.ok(!redirectAllowed('http://localhost.evil.com/api/auth/entra/callback'));
});

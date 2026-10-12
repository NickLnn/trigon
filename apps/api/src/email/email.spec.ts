import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailHtml, tokenRoles } from './email.service';

test('HTML body escapes content and keeps paragraphs', () => {
  const html = emailHtml('Hi <b>', 'Line one\nline two\n\n<script>x</script>', 'https://trigon.example.com');
  assert.ok(html.includes('Hi &lt;b&gt;'));
  assert.ok(html.includes('Line one<br>line two'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('reads app roles from a token', () => {
  const token = `h.${Buffer.from(JSON.stringify({ roles: ['Mail.Send'] })).toString('base64url')}.s`;
  assert.deepEqual(tokenRoles(token), ['Mail.Send']);
  assert.deepEqual(tokenRoles('not-a-jwt'), []);
});

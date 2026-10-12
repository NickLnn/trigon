import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tokenRoles } from './email.service';
import { renderEmailHtml, renderEmailText } from './template';

const content = {
  subject: 'Hi <b>',
  heading: 'Shared <script>x</script>',
  intro: 'Line one\nline two\n\nSecond paragraph',
  details: [{ label: 'Space', value: 'R&D' }],
  action: { label: 'Open page', url: 'https://trigon.example.com/d/1?a=1&b=2' },
  reason: 'Because.',
};

test('HTML escapes everything and embeds the logo source given', () => {
  const html = renderEmailHtml(content, { appUrl: 'https://trigon.example.com', logoSrc: 'cid:trigon-logo' });
  assert.ok(html.includes('Shared &lt;script&gt;x&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('R&amp;D'));
  assert.ok(html.includes('Line one<br>line two'));
  assert.ok(html.includes('href="https://trigon.example.com/d/1?a=1&amp;b=2"'));
  assert.ok(html.includes('src="cid:trigon-logo"'));
  assert.ok(html.includes('https://trigon.example.com/profile'));
});

test('plain text carries the same facts', () => {
  const text = renderEmailText(content, { appUrl: 'https://trigon.example.com' });
  assert.ok(text.includes('Space:'));
  assert.ok(text.includes('Open page: https://trigon.example.com/d/1?a=1&b=2'));
  assert.ok(text.includes('Manage email notifications: https://trigon.example.com/profile'));
});

test('reads app roles from a token', () => {
  const token = `h.${Buffer.from(JSON.stringify({ roles: ['Mail.Send'] })).toString('base64url')}.s`;
  assert.deepEqual(tokenRoles(token), ['Mail.Send']);
  assert.deepEqual(tokenRoles('not-a-jwt'), []);
});

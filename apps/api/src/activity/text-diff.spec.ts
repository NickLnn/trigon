import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textDiff } from './text-diff';

const render = (before: string, after: string) => textDiff(before, after).lines.map((l) => `${l.t}${l.s}`);

test('reports added, removed and changed lines with context', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
  const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
  const d = textDiff(before, after);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
  assert.deepEqual(render(before, after), [' b', ' c', '-d', '+D', ' e', ' f', '…', ' h', ' i', '+j']);
});

test('no change gives an empty diff', () => {
  assert.deepEqual(textDiff('x\ny', 'x\ny'), { added: 0, removed: 0, lines: [], truncated: false });
});

test('a new page is all additions', () => {
  const d = textDiff('', 'Title\nBody');
  assert.equal(d.added, 2);
  assert.equal(d.removed, 0);
});

test('interleaved edits find the minimal script', () => {
  const d = textDiff('a\nb\nc\nd', 'a\nx\nc\ny');
  assert.equal(d.added, 2);
  assert.equal(d.removed, 2);
  assert.deepEqual(render('a\nb\nc\nd', 'a\nx\nc\ny'), [' a', '-b', '+x', ' c', '-d', '+y']);
});

test('huge rewrites are capped', () => {
  const big = (p: string) => Array.from({ length: 3000 }, (_, i) => `${p}${i}`).join('\n');
  const d = textDiff(big('a'), big('b'));
  assert.equal(d.added, 3000);
  assert.equal(d.removed, 3000);
  assert.equal(d.lines.length, 400);
  assert.ok(d.truncated);
});

test('client IP: public peers are taken as is, the proxy stamp is trusted from private peers', async () => {
  const { clientIp } = await import('./request-context');
  assert.equal(clientIp({ 'x-trigon-client-ip': '1.2.3.4' }, '203.0.113.9'), '203.0.113.9');
  assert.equal(clientIp({ 'x-trigon-client-ip': '1.2.3.4' }, '::ffff:172.18.0.5'), '1.2.3.4');
  assert.equal(clientIp({ 'x-forwarded-for': '5.6.7.8, 172.18.0.1' }, '172.18.0.5'), '5.6.7.8');
  assert.equal(clientIp({}, '::ffff:192.168.xxx.xxx'), '192.168.xxx.xxx');
  assert.equal(clientIp({}, null), null);
});

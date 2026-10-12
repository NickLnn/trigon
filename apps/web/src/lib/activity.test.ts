import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEvent } from '@trigon/shared';
import { activityQuery, changeLines, summary, type ActivityFilters } from './activity';

const none: ActivityFilters = { q: '', category: '', action: '', actor: '', space: '', target: '', range: 'all', from: '', to: '' };

const event = (action: ActivityEvent['action'], details: Record<string, unknown>, targetType = 'page'): ActivityEvent => ({
  id: '1',
  at: new Date().toISOString(),
  actorId: null,
  actorName: 'Ada',
  actorEmail: null,
  action,
  category: 'content',
  spaceId: null,
  spaceName: null,
  targetType,
  targetId: null,
  targetName: 'Intune',
  details,
  ip: null,
  userAgent: null,
});

test('query string carries only the filters that are set', () => {
  assert.equal(activityQuery(none), '');
  const p = new URLSearchParams(activityQuery({ ...none, q: ' shared ', category: 'sharing', range: '7d' }));
  assert.equal(p.get('q'), 'shared');
  assert.equal(p.get('category'), 'sharing');
  const from = Date.parse(p.get('from')!);
  assert.ok(Math.abs(Date.now() - 7 * 86_400_000 - from) < 5_000);
});

test('custom range covers whole days', () => {
  const p = new URLSearchParams(activityQuery({ ...none, range: 'custom', from: '2026-10-01', to: '2026-10-02' }));
  assert.equal(new Date(p.get('from')!).getDate(), 1);
  assert.equal(new Date(p.get('to')!).getHours(), 23);
});

test('summaries read naturally', () => {
  assert.equal(summary(event('share.added', { sharedWith: 'Helpdesk', level: 'edit' })), 'Helpdesk · edit');
  assert.equal(summary(event('share.changed', { sharedWith: 'Bob', previousLevel: 'view', level: 'manage' })), 'Bob · view → manage');
  assert.equal(summary(event('item.renamed', { from: 'Old', to: 'New' })), 'Old → New');
  assert.equal(summary(event('page.edited', { saves: 4 })), '4 saves');
  assert.equal(summary(event('page.edited', { saves: 1, diff: { added: 3, removed: 1, lines: [], truncated: false } })), '+3 −1 lines · 1 save');
  assert.deepEqual(changeLines({ status: { from: 'none', to: 'draft' }, icon: { from: null, to: '🔑' }, sortMode: { from: 'alpha', to: 'manual' } }), [
    'Status: none → draft',
    'Icon changed',
    'Sort: A–Z → manual',
  ]);
});

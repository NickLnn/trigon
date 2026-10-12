import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DocumentNode } from '@trigon/shared';
import { buildTree } from './spaces.controller';

const node = (id: string, title: string, parentId: string | null = null, position = 0): DocumentNode => ({
  id,
  spaceId: 's',
  parentId,
  kind: 'page',
  title,
  icon: null,
  position,
  mimeType: null,
  pageType: 'page',
  status: 'none',
  updatedAt: '',
});

test('sorts every level alphabetically, ignoring case and manual position', () => {
  const tree = buildTree([
    node('1', 'VMware', null, 1),
    node('2', 'azure', null, 2),
    node('3', 'Microsoft', null, 3),
    node('4', 'Intune', '3', 1),
    node('5', '365', '3', 2),
    node('6', 'Defender', '3', 3),
  ]);
  assert.deepEqual(tree.map((n) => n.title), ['azure', 'Microsoft', 'VMware']);
  assert.deepEqual(tree[1].children!.map((n) => n.title), ['365', 'Defender', 'Intune']);
});

test('orders numbers naturally', () => {
  const tree = buildTree([node('a', 'Step 10'), node('b', 'Step 2'), node('c', 'Step 1')]);
  assert.deepEqual(tree.map((n) => n.title), ['Step 1', 'Step 2', 'Step 10']);
});

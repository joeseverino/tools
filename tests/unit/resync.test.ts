import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resyncRows } from '../../lib/resync/plan.ts';

test('only git repos with a remote are planned, dirty = dirty + untracked', () => {
  const repos = [
    { name: 'x', path: '/x', git: true, has_remote: true, dirty: 1, untracked: 2 },
    { name: 'nogit', path: '/n', git: false, has_remote: true },
    { name: 'b', path: '/b', git: true, has_remote: false },
    { name: 'clean', path: '/c', git: true, has_remote: true },
  ];
  assert.deepEqual(resyncRows(repos), [
    { name: 'x', path: '/x', dirty: 3 },
    { name: 'clean', path: '/c', dirty: 0 },
  ]);
});

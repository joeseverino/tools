import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGreen, landRows } from '../../lib/land/plan.ts';

test('only repos with an open PR are planned, projected to land columns', () => {
  const repos = [
    { name: 'g', path: '/g', pr: { state: 'open', number: 12, ci: 'passing', url: 'u12' } },
    { name: 'closed', path: '/c', pr: { state: 'merged', number: 9 } },
    { name: 'nopr', path: '/n' },
  ];
  assert.deepEqual(landRows(repos), [{ name: 'g', path: '/g', number: 12, ci: 'passing', url: 'u12' }]);
});

test('passing and no-check CI count as green', () => {
  assert.equal(isGreen('passing'), true);
  assert.equal(isGreen('none'), true);
  assert.equal(isGreen('failing'), false);
  assert.equal(isGreen('pending'), false);
});

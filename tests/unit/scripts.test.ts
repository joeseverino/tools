import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskRecord } from '../../lib/backlog/result.ts';
import { render } from '../../lib/brief/daily.ts';
import { repoPaths, rowsOf, verdictOf } from '../../lib/gate-preview/report.ts';
import { gateScript } from '../../lib/ship/gate-script.ts';
import { summarize } from '../../lib/tools/contract-summary.ts';
import { nextOrder } from '../../lib/tools/next-order.ts';
import { versionOf } from '../../lib/tools/package-version.ts';
import { dailyRecord } from '../../lib/vault/daily-result.ts';

test('gateScript prefers check, then test', () => {
  assert.equal(gateScript({ scripts: { check: 'x', test: 'y' } }), 'check');
  assert.equal(gateScript({ scripts: { test: 'y' } }), 'test');
  assert.equal(gateScript({ scripts: {} }), '');
  assert.equal(gateScript({ scripts: 'oops' }), '');
  assert.equal(gateScript(undefined), '');
});

test('gate-preview paths accept {repos:[...]} or a bare array', () => {
  assert.deepEqual(repoPaths({ repos: [{ path: '/a' }, { path: '/b' }] }), ['/a', '/b']);
  assert.deepEqual(repoPaths([{ path: '/a' }]), ['/a']);
  assert.deepEqual(repoPaths('x'), []);
});

test('gate-preview verdict and rows', () => {
  assert.equal(verdictOf({ ok: true }), 'ok');
  assert.equal(verdictOf({ ok: false, failed: ['a', 'b'] }), 'RED a,b');
  assert.equal(verdictOf({ ok: false }), 'ERROR no verdict');
  assert.equal(verdictOf(undefined), 'ERROR no verdict');
  assert.deepEqual(rowsOf(['one|ok', 'two|RED a,b', 'three|ERROR no verdict']), {
    ok: false,
    repos: [
      { repo: 'one', ok: true },
      { repo: 'two', ok: false, failed: ['a', 'b'] },
      { repo: 'three', ok: false },
    ],
  });
  assert.equal(rowsOf(['one|ok']).ok, true);
});

test('package-version returns only a string version', () => {
  assert.equal(versionOf({ version: '1.2.3' }), '1.2.3');
  assert.equal(versionOf({ version: 3 }), null);
  assert.equal(versionOf(null), null);
});

test('contract-summary counts current and unavailable projections', () => {
  const report = { ok: false, projections: [{ ok: true }, { ok: true, skipped: true }, { ok: false }] };
  assert.deepEqual(summarize(report), { ok: false, detail: '1 current, 1 unavailable' });
  assert.throws(() => summarize({ ok: true }), /not a contracts report/);
});

test('next-order rounds the highest order up to a multiple of ten, plus ten', () => {
  assert.equal(nextOrder({ tools: [{ order: 5 }, { order: 210 }, { order: 'x' }] }), 220);
  assert.equal(nextOrder({ tools: [{ order: 215 }] }), 230);
  assert.equal(nextOrder({}), 10);
  assert.equal(nextOrder(null), 10);
});

test('daily-result and task-result fold the MCP envelope into tab records', () => {
  assert.equal(dailyRecord({ ok: true, wrote: 'p.md', created: true }), 'ok\tp.md\tcreated');
  assert.equal(dailyRecord({ ok: true, wrote: 'p.md' }), 'ok\tp.md\tupdated');
  assert.equal(dailyRecord({ ok: false, error: 'bad' }), 'err\tbad');
  assert.equal(dailyRecord(undefined), 'err\tfailed');
  assert.deepEqual(taskRecord({ ok: true, doc_id: 'd', status: 's', previous: 'p', relative_path: 'r' }), { line: 'ok\td\ts\tp\tr', ok: true });
  assert.deepEqual(taskRecord({ ok: true }), { line: 'ok\t\t\t\t', ok: true });
  assert.deepEqual(taskRecord({ ok: false }), { line: 'err\tfailed', ok: false });
});

test('daily render drops empty sections and ignores malformed rows', () => {
  assert.equal(render({}, '2026-01-02'), '> [!note] 2026-01-02\n> nothing recorded yet — log it below');
  const block = render({
    commits: [{ repo: 'a', subjects: ['x', 'y'] }, { repo: 1 }],
    closed: [{ doc_id: 'q', title: 'Q', project: 'z' }, 'junk'],
  }, '2026-01-02');
  assert.match(block, /^> \[!note\] 2026-01-02\n> 2 commits · 1 shipped/);
  assert.match(block, /> - \*\*a\*\* — x/);
  assert.match(block, /> - \[\[q\|Q\]\] · z/);
});

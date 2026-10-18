import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callRequest, syncRequest } from '../../lib/hq/data.ts';
import { failureMessage, jqText, resultOk } from '../../lib/hq/env.ts';
import { tool } from '../../lib/hq/main.ts';
import { createHelp, createRequest, doctorReport, stateRecord, syncSummary, validateReport } from '../../lib/hq/report.ts';
import { compareRecord, manifestHash, readRecord } from '../../lib/hq/state.ts';
import { definitionDrift } from '../../lib/sdk/tool.ts';

test('every spec command has a handler and no handler is undeclared', () => {
  assert.deepEqual(definitionDrift(tool), []);
});

test('callRequest wraps one JSON object and rejects everything else', () => {
  assert.deepEqual(callRequest('audit_registry', ''), { tool: 'audit_registry', arguments: {} });
  assert.deepEqual(callRequest('list', '{"limit":2}'), { tool: 'list', arguments: { limit: 2 } });
  assert.equal(callRequest('x', '[1]'), null);
  assert.equal(callRequest('x', 'nope'), null);
});

test('syncRequest sends numeric prune and update flags and the manifest', () => {
  assert.deepEqual(syncRequest([{ doc_id: 'a' }], { prune: true, update: false }), {
    tool: 'execute_capability',
    arguments: {
      name: 'hq.sync',
      payload: { manifest: [{ doc_id: 'a' }], update_existing: 0, report_orphans: true, prune_orphans: 1, confirm_prune: 1 },
    },
  });
});

test('jq-compatible helpers', () => {
  assert.equal(jqText('a'), 'a');
  assert.equal(jqText(null), 'null');
  assert.equal(jqText({ a: 1 }), '{"a":1}');
  assert.equal(resultOk({ ok: true }), true);
  assert.equal(resultOk({ ok: false }), false);
  assert.equal(resultOk(undefined), false);
  assert.equal(failureMessage({ error: { message: 'boom' } }, 'fallback'), 'boom');
  assert.equal(failureMessage({ ok: false }, 'fallback'), 'fallback');
  assert.equal(failureMessage(undefined, 'fallback'), '');
});

test('createRequest maps ergonomic aliases to the upsert payload', () => {
  assert.deepEqual(createRequest(['project', 'example', '--name', 'Example', '--repo', 'https://e.test/r', '--json']), {
    tool: 'execute_capability',
    arguments: { name: 'project.upsert', payload: { slug: 'example', name: 'Example', repository_url: 'https://e.test/r' } },
  });
  assert.throws(() => createRequest(['project', 'x', '--name']), /expected --field value/);
  assert.throws(() => createRequest(['widget', 'x']), /usage: hq create/);
});

test('createHelp lists fields with required, default and enum detail', () => {
  const catalog = {
    capabilities: [
      {
        name: 'project.upsert',
        summary: 'Create a project.',
        input_schema: { required: ['name'], properties: { slug: { type: 'string' }, name: { type: 'string' }, status: { type: 'string', default: 'idea' }, cat: { enum: ['a', 'b'] } } },
      },
    ],
  };
  assert.equal(
    createHelp(catalog, 'project'),
    "Usage: hq create project <slug> [--field value ...]\n\nCreate a project.\n\nFields:\n  --name                       required; string\n  --status                     default: 'idea'; string\n  --cat                        one of: a, b\n",
  );
  assert.throws(() => createHelp(catalog, 'asset'), /does not advertise asset\.upsert/);
});

test('syncSummary reports changes, relations, content and cleanup', () => {
  const stats = { created: 1, updated: 2, missing_relations: 1, missing_relations_detail: [{ doc_id: 'a', kind: 'project', slug: 'p' }], orphans: ['z'], content_items_synced: 3 };
  assert.equal(
    syncSummary([{}, {}], stats, false),
    'Docs      2 indexed\nChanges   1 created, 2 updated\nRelations 1 missing\n          a → missing project p\nContent   3 mirrored\nCleanup   1 orphan doc row(s); run `hq sync --prune`\n          z\nDone      synced with cleanup needed\n',
  );
  assert.match(syncSummary([], {}, false), /Done {6}HQ is in sync/);
  assert.match(syncSummary([], { orphans: ['z'] }, true), /Cleanup {3}pruned 1 orphan doc row/);
  assert.throws(() => syncSummary([], null, false), /unexpected shape/);
});

test('doctorReport is clean or lists duplicates and missing frontmatter with exit 1', () => {
  assert.deepEqual(doctorReport({ count: 3 }), { text: 'ok: 3 indexed docs have valid frontmatter\n', code: 0 });
  const bad = doctorReport({ missing_frontmatter: ['a.md'], duplicates: [{ doc_id: 'd', first: 'x', second: 'y' }] });
  assert.equal(bad.code, 1);
  assert.equal(bad.text, '1 duplicate doc_id(s):\n  - d: x  <->  y\n1 doc(s) missing or invalid frontmatter:\n  - a.md\n');
});

test('validateReport summarises orphans', () => {
  const text = validateReport({ projects_total: 2, assets_total: 1, orphan_projects: ['old'], orphan_assets: [] });
  assert.match(text, /^Projects {2}2 total, 1 with zero docs\n {10}orphan: old\nAssets {4}1 total, 0 with zero docs\nRegistry {2}review orphans/);
});

test('stateRecord and the freshness check agree on the manifest hash', () => {
  const manifest = '[{"doc_id":"a"}]\n';
  const record = JSON.parse(stateRecord(Buffer.from(manifest), '/vault', 'mcp-default', 'abc', new Date('2026-01-02T03:04:05.678Z'))) as Record<string, string>;
  assert.equal(record['synced_at'], '2026-01-02T03:04:05Z');
  assert.equal(record['manifest_sha256'], manifestHash(manifest.trimEnd()));
  const parsed = readRecord(JSON.stringify(record));
  assert.ok(parsed);
  assert.deepEqual(compareRecord(parsed, manifestHash(manifest)), { kind: 'fresh', date: '2026-01-02' });
  assert.deepEqual(compareRecord(parsed, manifestHash('[]')), { kind: 'stale', date: '2026-01-02' });
  assert.equal(readRecord('not json'), null);
});

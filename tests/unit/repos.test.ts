import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ciRollup, parsePrBlob, projectPr } from '../../lib/repos/pr.ts';
import { planRows, reposFrom } from '../../lib/repos/project.ts';
import { buildRepo } from '../../lib/repos/record.ts';
import type { ParsedRecord } from '../../lib/repos/record.ts';
import { isRecord, parseJson } from '../../lib/sdk/guards.ts';

function makeRecord(overrides: Partial<ParsedRecord> = {}): ParsedRecord {
  return {
    name: 'tools', root: 'assets', path: '/code/tools', git: true, branch: 'main', remote: 'git@x:y/z.git',
    has_remote: true, dirty: 2, untracked: 1, ahead: 3, behind: 0, upstream: true,
    upstream_name: 'origin/main', upstream_track: '[ahead 3]', upstream_gone: false, sha: 'abc1234',
    date: '2026-10-01', subject: 'feat: x', lang: 'ts', pm: 'npm', package_manager: 'npm@11', nvmrc: '24',
    node_modules: true, node_modules_size: '4.2M', ci: 1, icloud_dups: 5, stash: 0, local_ok: false,
    needs_ship: true, needs_resync: false, needs_attention: true, branch_state: 'current',
    ...overrides,
  };
}

test('buildRepo nests last_commit and gates icloud_dups and pr', () => {
  const rec = makeRecord();
  const plain = buildRepo(rec);
  assert.deepEqual(plain.last_commit, { sha: 'abc1234', date: '2026-10-01', subject: 'feat: x' });
  assert.equal('icloud_dups' in plain, false);
  assert.equal('pr' in plain, false);
  assert.equal(plain.branch_state, 'current');

  assert.equal(buildRepo(rec, { icloud: true }).icloud_dups, 5);

  const open = buildRepo(rec, { pr: { number: 9, state: 'open', ci: 'passing', review: 'none', url: 'u' } });
  assert.equal(open.branch_state, 'pr');
  assert.equal(open.pr?.number, 9);

  const merged = buildRepo(rec, { pr: { number: 9, state: 'merged', ci: 'passing', review: 'none', url: 'u' } });
  assert.equal(merged.branch_state, 'current');
});

test('buildRepo emits exactly the properties of the published repos schema', () => {
  const schema = parseJson(readFileSync(new URL('../../schemas/repos.schema.json', import.meta.url), 'utf8'));
  const defs = isRecord(schema) && isRecord(schema['$defs']) ? schema['$defs'] : {};
  const repo = isRecord(defs['repo']) ? defs['repo'] : {};
  const properties = isRecord(repo['properties']) ? Object.keys(repo['properties']).sort() : [];
  const built = Object.keys(buildRepo(makeRecord(), { icloud: true, pr: { number: 1, state: 'open', ci: 'none', review: 'none', url: '' } })).sort();
  assert.deepEqual(built, properties);
});

test('ciRollup: failing beats pending beats passing; empty is none', () => {
  assert.equal(ciRollup(undefined), 'none');
  assert.equal(ciRollup([]), 'none');
  assert.equal(ciRollup([{ conclusion: 'SUCCESS', status: 'COMPLETED' }]), 'passing');
  assert.equal(ciRollup([{ conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }]), 'failing');
  assert.equal(ciRollup([{ conclusion: 'SUCCESS', status: 'COMPLETED' }, { status: 'QUEUED' }]), 'pending');
  assert.equal(ciRollup([{ state: 'SUCCESS' }]), 'passing');
});

test('projectPr degrades a missing PR to the no-PR default', () => {
  const none = { number: 0, state: 'none', ci: 'none', review: 'none', url: '' };
  assert.deepEqual(projectPr(null), none);
  assert.deepEqual(projectPr({}), none);
  assert.equal(projectPr({ number: 4, isDraft: true, state: 'OPEN' }).state, 'draft');
  const pr = projectPr({ number: 4, state: 'OPEN', reviewDecision: 'APPROVED', url: 'u', statusCheckRollup: [] });
  assert.deepEqual(pr, { number: 4, state: 'open', ci: 'none', review: 'approved', url: 'u' });
  assert.equal(projectPr({ number: 4, reviewDecision: null }).review, 'none');
  assert.equal(parsePrBlob(''), null);
  assert.equal(parsePrBlob('not json'), null);
  assert.equal(parsePrBlob('{"number":"x"}'), null);
  assert.equal(parsePrBlob('{"number":3,"state":"OPEN"}')?.number, 3);
});

test('reposFrom and planRows read a repos payload defensively', () => {
  assert.deepEqual(reposFrom('garbage'), []);
  assert.deepEqual(reposFrom({ repos: 'x' }), []);
  const payload = { repos: [{ name: 'a', path: '/a', dirty: 1 }, { name: 1 }, { name: 'b', path: '/b' }] };
  assert.equal(reposFrom(payload).length, 2);
  const rows = planRows(payload, (repo) => (repo.dirty ? [repo.name, repo.path, repo.dirty] : null));
  assert.equal(rows, 'a\t/a\t1\n');
  assert.equal(planRows(payload, () => null), '');
});

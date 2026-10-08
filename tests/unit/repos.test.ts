import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ciRollup, projectPr } from '../../lib/repos/pr.ts';
import { planRows, reposFrom } from '../../lib/repos/project.ts';
import { RECORD_FIELDS, buildRepo, parseRecord } from '../../lib/repos/record.ts';

function recordLine(overrides: Record<string, string> = {}): string {
  const defaults: Record<string, string> = {
    name: 'tools', root: 'assets', path: '/code/tools', git: '1', branch: 'main', remote: 'git@x:y/z.git',
    has_remote: '1', dirty: '2', untracked: '1', ahead: '3', behind: '0', upstream: '1',
    upstream_name: 'origin/main', upstream_track: '[ahead 3]', upstream_gone: '0', sha: 'abc1234',
    date: '2026-10-01', subject: 'feat: x', lang: 'ts', pm: 'npm', package_manager: 'npm@11', nvmrc: '24',
    node_modules: '1', node_modules_size: '"4.2M"', ci: '1', icloud_dups: '5', stash: '0', local_ok: '0',
    needs_ship: '1', needs_resync: '0', needs_attention: '1', branch_state: 'current',
  };
  const merged = { ...defaults, ...overrides };
  return RECORD_FIELDS.map((field) => merged[field.key] ?? '').join('\x1f') + '\x1f\n';
}

test('parseRecord coerces each field by its declared type', () => {
  const rec = parseRecord(recordLine());
  assert.equal(rec.name, 'tools');
  assert.equal(rec.git, true);
  assert.equal(rec.dirty, 2);
  assert.equal(rec.node_modules_size, '4.2M');
  assert.equal(rec.upstream_gone, false);
  assert.equal(rec.needs_attention, true);
});

test('parseRecord tolerates a short line and a bad raw field', () => {
  const rec = parseRecord('name\x1froot\x1f/p');
  assert.equal(rec.name, 'name');
  assert.equal(rec.dirty, 0);
  assert.equal(rec.git, false);
  assert.equal(rec.node_modules_size, null);
  assert.equal(parseRecord(recordLine({ node_modules_size: 'oops{' })).node_modules_size, null);
  assert.equal(parseRecord(recordLine({ node_modules_size: 'null' })).node_modules_size, null);
});

test('buildRepo nests last_commit and gates icloud_dups and pr', () => {
  const rec = parseRecord(recordLine());
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

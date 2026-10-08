import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpsUrl, parseRepoArgs, projectDoc, titleCase } from '../../lib/repo/main.ts';

const reject = (kind: string, token: string): never => {
  throw new Error(`${kind}:${token}`);
};

test('titleCase capitalises each hyphen-separated word', () => {
  assert.equal(titleCase('my-cool-tool'), 'My Cool Tool');
  assert.equal(titleCase('x'), 'X');
});

test('httpsUrl normalises GitHub ssh remotes and strips .git', () => {
  assert.equal(httpsUrl('git@github.com:o/r.git'), 'https://github.com/o/r');
  assert.equal(httpsUrl('https://github.com/o/r.git'), 'https://github.com/o/r');
  assert.equal(httpsUrl(''), '');
});

test('parseRepoArgs reads flags, one slug, and rejects the rest', () => {
  const parsed = parseRepoArgs(['demo', '--root', 'assets', '--track', 'node', '--name', 'N', '--public', '--local', '--no-register', '-n', '--category', 'c', '--description', 'd', '--path', '/p'], reject);
  assert.deepEqual(parsed, {
    slug: 'demo', root: 'assets', track: 'node', name: 'N', category: 'c', description: 'd',
    visibility: '--public', local: true, register: false, dry: true, path: '/p',
  });
  assert.deepEqual(parseRepoArgs(['--root'], reject), { exit: 1 });
  assert.throws(() => parseRepoArgs(['a', 'b'], reject), /argument:b/);
  assert.throws(() => parseRepoArgs(['--nope'], reject), /flag:--nope/);
});

test('projectDoc writes the vault project frontmatter and body', () => {
  const doc = projectDoc({ slug: 'demo', name: 'Demo', description: '' }, '/code/demo', '2026-01-02');
  assert.match(doc, /^---\ndoc_id: project-demo\ntitle: Demo\n/);
  assert.match(doc, /\nlast_reviewed: 2026-01-02\n/);
  assert.match(doc, /\nproject_path: \/code\/demo\naliases:\n {2}- Demo\n---\n\n# Demo\n\n## What this is\n\n<!-- one paragraph/);
  assert.match(doc, /Source: `\/code\/demo\/`\.\n$/);
  assert.match(projectDoc({ slug: 'demo', name: 'Demo', description: 'A demo.' }, '/d', 'x'), /## What this is\n\nA demo\.\n/);
});

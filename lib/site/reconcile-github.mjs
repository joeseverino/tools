#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const siteHome = process.argv[2];
const gh = process.env.GH_BIN || 'gh';
const lock = JSON.parse(fs.readFileSync(path.join(siteHome, 'package-lock.json'), 'utf8'));
const run = (args) => spawnSync(gh, args, { cwd: siteHome, encoding: 'utf8' });

const list = run(['pr', 'list', '--state', 'open', '--author', 'app/dependabot', '--json', 'number,body']);
if (list.status !== 0) throw new Error(list.stderr.trim());
for (const pr of JSON.parse(list.stdout)) {
  const match = pr.body.match(/Updates `([^`]+)` from [^\n]+ to `?([^`\s]+)`?/);
  if (!match) continue;
  const [, name, target] = match;
  if (lock.packages?.[`node_modules/${name}`]?.version !== target) continue;
  const closed = run(['pr', 'close', String(pr.number), '--comment', `Superseded: main already contains ${name} ${target}.`]);
  if (closed.status !== 0) throw new Error(closed.stderr.trim());
  console.log(`closed Dependabot PR #${pr.number}: ${name} ${target} already landed`);
}

const security = spawnSync('npm', ['run', '-s', 'check:security'], { cwd: siteHome, encoding: 'utf8' });
if (security.status === 0) {
  const issues = run(['issue', 'list', '--state', 'open', '--label', 'security-txt-expires', '--json', 'number']);
  if (issues.status !== 0) throw new Error(issues.stderr.trim());
  for (const issue of JSON.parse(issues.stdout)) {
    const closed = run([
      'issue', 'close', String(issue.number), '--reason', 'completed', '--comment',
      'Closing automatically: the current security.txt signature and expiry pass the repository security gate.',
    ]);
    if (closed.status !== 0) throw new Error(closed.stderr.trim());
    console.log(`closed stale security.txt issue #${issue.number}`);
  }
}

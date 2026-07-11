#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [siteHome, ...prs] = process.argv.slice(2);
if (!siteHome || prs.length === 0) process.exit(2);
const gh = process.env.GH_BIN || 'gh';
const pkgPath = path.join(siteHome, 'package.json');
const lockPath = path.join(siteHome, 'package-lock.json');
const beforePkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const beforeLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const requested = new Set();
const run = (cmd, args) => spawnSync(cmd, args, { cwd: siteHome, encoding: 'utf8' });

for (const pr of prs) {
  const view = run(gh, ['pr', 'view', pr, '--json', 'author,body,state']);
  if (view.status !== 0) throw new Error(view.stderr.trim());
  const data = JSON.parse(view.stdout);
  if (data.author?.login !== 'app/dependabot' || data.state !== 'OPEN') {
    throw new Error(`#${pr} is not an open Dependabot PR`);
  }
  const match = data.body.match(/Updates `([^`]+)` from [^\n]+ to `?([^`\s]+)`?/);
  if (!match) throw new Error(`could not read package/version from #${pr}`);
  const [, name, version] = match;
  requested.add(name);
  const section = ['dependencies', 'devDependencies', 'optionalDependencies']
    .find((key) => beforePkg[key]?.[name]);
  if (!section) throw new Error(`${name} is not a direct dependency`);
  const prefix = beforePkg[section][name].match(/^[~^]/)?.[0] ?? '';
  const saveFlag = section === 'devDependencies'
    ? '--save-dev'
    : section === 'optionalDependencies' ? '--save-optional' : '--save';
  const install = spawnSync(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', saveFlag, `${name}@${prefix}${version}`],
    { cwd: siteHome, stdio: 'inherit' },
  );
  if (install.status !== 0) process.exit(install.status || 1);
  console.log(`absorbed #${pr}: ${name} ${prefix}${version}`);
}

const afterPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const afterLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(beforePkg[section] || {})) {
    if (!requested.has(name) && beforePkg[section][name] !== afterPkg[section]?.[name]) {
      throw new Error(`unrelated direct range changed: ${name}`);
    }
    const beforeVersion = beforeLock.packages?.[`node_modules/${name}`]?.version;
    const afterVersion = afterLock.packages?.[`node_modules/${name}`]?.version;
    if (!requested.has(name) && beforeVersion !== afterVersion) {
      throw new Error(`unrelated direct package changed: ${name} ${beforeVersion} -> ${afterVersion}`);
    }
  }
}

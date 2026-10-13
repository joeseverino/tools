import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SilentExit, die, usageError } from '../sdk/cli.ts';
import { palette, msg } from '../sdk/output.ts';
import { codeHome } from '../sdk/paths.ts';
import { run } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

const NAME_HELP = 'Display name (default: slug, title-cased)';
const CATEGORY_HELP = 'HQ project category (default automation)';
const DESCRIPTION_HELP = 'One-liner for the vault doc + HQ entry';

export const spec: ToolSpec = {
  name: 'repo',
  description: 'Fleet entry as one verb — bootstrap a new repo from the baseline and register it everywhere.',
  group: 'Workspace',
  order: 230,
  leafCommands: true,
  effect: 'remote_write',
  synopsis: ['repo new <slug> [options] | repo register <slug> [options]'],
  paras: [
    "The fleet's front door. 'repo new' automates the cordon-starter README procedure end to end — copy the baseline, keep one emitter track, fresh git history, local guardrail hooks, initial commit, 'gh repo create', branch protection — then registers the repo in the vault project registry and HQ. 'repo register' is that registration half alone, for a repo that already exists on disk (the backfill path).",
    "Registration writes '01 Projects/<slug>/index.md' (frontmatter per the vault schema; skipped if it exists), upserts the HQ Project record via 'hq create project', and runs 'hq sync' so relations resolve immediately. One entry path means no repo can be on disk but invisible to the registry.",
  ],
  examples: [
    { command: 'repo new my-tool --description "One-liner for the docs"', comment: 'private bash-track repo in Projects/, registered' },
    { command: 'repo new my-mcp --root assets --track node --category automation', comment: 'node-track repo in Assets/' },
    { command: 'repo register screencasts --category automation', comment: 'backfill an existing repo into the registry' },
    { command: 'repo new scratch --local --no-register -n', comment: 'dry-run a local-only scratch repo' },
  ],
  env: [
    { name: 'CODE_HOME', help: 'Roots the Code tree (~/.zshrc); repos live in Assets/ or Projects/' },
    { name: 'NOTES_HOME', help: 'The vault root — 01 Projects/<slug>/index.md is written there' },
    { name: 'STARTER_HOME', help: 'The cordon-starter checkout (default $CODE_HOME/Projects/cordon-starter)' },
  ],
  commands: [
    {
      name: 'new',
      summary: 'Bootstrap a repo from the cordon-starter baseline, then register it',
      effect: 'remote_write',
      options: [
        { flags: ['--root'], metavar: 'R', help: 'assets|projects — which Code root the repo lives under (default projects)' },
        { flags: ['--track'], metavar: 'T', help: 'bash|node — the emitter track to keep (default bash)' },
        { flags: ['--name'], metavar: 'NAME', help: 'Display name for the vault doc + HQ (default: slug, title-cased)' },
        { flags: ['--category'], metavar: 'CAT', help: CATEGORY_HELP },
        { flags: ['--description'], metavar: 'TEXT', help: DESCRIPTION_HELP },
        { flags: ['--public'], help: 'Create the GitHub repo public (default private)' },
        { flags: ['--local'], help: 'Skip GitHub entirely — no gh create, no branch protection' },
        { flags: ['--no-register'], help: 'Skip the vault doc + HQ registration' },
        { flags: ['-n', '--dry-run'], help: 'Print the plan; touch nothing' },
      ],
      positionals: [{ name: 'slug', help: 'kebab-case name — becomes the dir, the tool name, and the registry slug' }],
    },
    {
      name: 'register',
      summary: 'Register an existing repo: vault project doc + HQ record + hq sync',
      effect: 'remote_write',
      options: [
        { flags: ['--path'], metavar: 'DIR', help: 'Repo directory (default: $CODE_HOME/Assets/<slug> then $CODE_HOME/Projects/<slug>)' },
        { flags: ['--name'], metavar: 'NAME', help: NAME_HELP },
        { flags: ['--category'], metavar: 'CAT', help: CATEGORY_HELP },
        { flags: ['--description'], metavar: 'TEXT', help: DESCRIPTION_HELP },
        { flags: ['-n', '--dry-run'], help: 'Print the plan; touch nothing' },
      ],
      positionals: [{ name: 'slug', help: "The repo's registry slug (its directory name)" }],
    },
  ],
};

export interface RepoArgs {
  slug: string;
  root: string;
  track: string;
  name: string;
  category: string;
  description: string;
  visibility: '--private' | '--public';
  local: boolean;
  register: boolean;
  dry: boolean;
  path: string;
}

const VALUE_FLAGS = new Set(['--root', '--track', '--name', '--category', '--description', '--path']);

/** Parses the flags shared by `new` and `register`; an unknown token goes through `reject`. */
export function parseRepoArgs(args: readonly string[], reject: (kind: string, token: string) => never): RepoArgs | { exit: number } {
  const parsed: RepoArgs = {
    slug: '', root: 'projects', track: 'bash', name: '', category: 'automation', description: '',
    visibility: '--private', local: false, register: true, dry: false, path: '',
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (VALUE_FLAGS.has(arg)) {
      const value = args[index + 1];
      if (value === undefined) return { exit: 1 };
      index += 1;
      switch (arg) {
        case '--root': parsed.root = value; break;
        case '--track': parsed.track = value; break;
        case '--name': parsed.name = value; break;
        case '--category': parsed.category = value; break;
        case '--description': parsed.description = value; break;
        default: parsed.path = value;
      }
    } else if (arg === '--public') parsed.visibility = '--public';
    else if (arg === '--local') parsed.local = true;
    else if (arg === '--no-register') parsed.register = false;
    else if (arg === '-n' || arg === '--dry-run') parsed.dry = true;
    else if (arg.startsWith('-')) return reject('flag', arg);
    else if (parsed.slug) return reject('argument', arg);
    else parsed.slug = arg;
  }
  return parsed;
}

export function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The origin remote as a display URL, ssh remotes normalised to https. */
export function httpsUrl(remote: string): string {
  const url = remote.replace(/\.git$/, '');
  return url.startsWith('git@github.com:') ? `https://github.com/${url.slice('git@github.com:'.length)}` : url;
}

export function projectDoc(args: Pick<RepoArgs, 'slug' | 'name' | 'description'>, dir: string, reviewed: string): string {
  const { slug, name } = args;
  const what = args.description || '<!-- one paragraph: what this repo is and why it exists -->';
  return `---
doc_id: project-${slug}
title: ${name}
doc_type: architecture_note
system: ${slug}
environment: local_mac
status: active
sensitivity: internal
last_reviewed: ${reviewed}
related_projects: []
related_assets: []
tags: []
project_path: ${dir}
aliases:
  - ${name}
---

# ${name}

## What this is

${what}

## How it fits the fleet

<!-- what it consumes, what consumes it, which projects it relates to -->

## Build & dev

Source: \`${dir}/\`.
`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** A failing step aborts the run with that step's exit status, as a shell script under `set -e` would. */
function must(status: number | null): void {
  if (status !== 0) throw new SilentExit(status ?? 1);
}

function stdoutHidden(bin: string, args: string[], cwd?: string): number | null {
  return spawnSync(bin, args, { stdio: ['inherit', 'ignore', 'inherit'], ...(cwd ? { cwd } : {}) }).status;
}

function quiet(bin: string, args: string[], cwd: string): boolean {
  return spawnSync(bin, args, { cwd, stdio: 'ignore' }).status === 0;
}

function registerRepo(args: RepoArgs, dir: string): void {
  const notesHome = process.env['NOTES_HOME'];
  if (!notesHome) die('error', 'NOTES_HOME: set in ~/.zshrc');
  const remote = run('git', ['-C', dir, 'remote', 'get-url', 'origin']);
  const url = remote.ok ? httpsUrl(remote.stdout.replace(/\n+$/, '')) : '';
  const indexDir = path.join(notesHome, '01 Projects', args.slug);
  const index = path.join(indexDir, 'index.md');

  if (existsSync(index) && statSync(index).isFile()) {
    msg('dim', 'kept', `vault doc exists: 01 Projects/${args.slug}/index.md`);
  } else {
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(index, projectDoc(args, dir, today()));
    msg('green', 'vault', `01 Projects/${args.slug}/index.md`);
  }

  const hqArgs = ['create', 'project', args.slug, '--name', args.name, '--category', args.category, '--status', 'active'];
  if (url) hqArgs.push('--repo', url);
  if (args.description) hqArgs.push('--description', args.description);
  must(stdoutHidden('hq', hqArgs));
  msg('green', 'hq', `project record upserted (${args.category}, active)`);
  must(stdoutHidden('hq', ['sync']));
  msg('green', 'synced', `relations to '${args.slug}' resolve`);
}

function rewriteSlug(file: string, from: string, to: string): void {
  const text = readFileSync(file, 'latin1').split(from).join(to);
  writeFileSync(`${file}.tmp`, text, 'latin1');
  renameSync(`${file}.tmp`, file);
}

function bootstrap(args: RepoArgs, starter: string, dest: string): void {
  const p = palette();
  const { slug, track } = args;
  must(spawnSync('rsync', ['-a', '--exclude', '.git', `${starter}/`, `${dest}/`], { stdio: 'inherit' }).status);
  must(spawnSync('git', ['-C', dest, 'init', '-qb', 'main'], { stdio: 'inherit' }).status);
  msg('green', 'created', `${dest} ${p.DIM}from cordon-starter${p.RESET}`);

  const kept = track === 'bash' ? 'example-tool' : 'example-node';
  const dropped = track === 'bash' ? 'example-node' : 'example-tool';
  const bin = path.join(dest, 'bin');
  const contract = path.join(dest, 'contract');
  renameSync(path.join(bin, kept), path.join(bin, slug));
  rmSync(path.join(bin, dropped), { force: true });
  rmSync(path.join(contract, `${dropped}.json`), { force: true });
  if (track === 'bash') rmSync(path.join(dest, 'package.json'), { force: true });
  rmSync(path.join(contract, `${kept}.json`), { force: true });
  for (const file of [path.join(bin, slug), path.join(dest, 'package.json')]) {
    if (existsSync(file) && statSync(file).isFile()) rewriteSlug(file, kept, slug);
  }
  const launcher = path.join(bin, slug);
  chmodSync(launcher, statSync(launcher).mode | 0o111);
  msg('green', 'track', `${track} — bin/${slug} ${p.DIM}(rewrite its describe_spec)${p.RESET}`);

  const contractFile = path.join(contract, `${slug}.json`);
  if (track === 'bash') {
    const described = spawnSync(launcher, ['--describe'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'ignore'] });
    let wrote = false;
    if (described.status === 0) {
      try {
        writeFileSync(contractFile, described.stdout);
        wrote = true;
      } catch {
        wrote = false;
      }
    }
    if (wrote) msg('green', 'contract', `contract/${slug}.json`);
    else {
      rmSync(contractFile, { force: true });
      msg('yellow', 'contract', `regen failed — finish: bin/${slug} --describe > contract/${slug}.json`);
    }
  } else if (quiet('node', [`bin/${slug}`, '--write'], dest)) msg('green', 'contract', `contract/${slug}.json`);
  else msg('yellow', 'contract', `regen failed — finish: node bin/${slug} --write`);

  quiet('scripts/setup-hooks.sh', [], dest);
  if (quiet('scripts/check.sh', [], dest)) msg('green', 'gate', 'scripts/check.sh green');
  else msg('yellow', 'gate', 'scripts/check.sh red — finish the rename, then re-run it');

  must(spawnSync('git', ['-C', dest, 'add', '-A'], { stdio: 'inherit' }).status);
  must(spawnSync('git', ['-C', dest, 'commit', '-qm', 'Initial commit'], { stdio: 'inherit' }).status);
  msg('green', 'committed', 'initial commit on main');

  if (args.local) msg('dim', 'local', 'skipped gh create + governance (--local)');
  else {
    must(stdoutHidden('gh', ['repo', 'create', slug, args.visibility, '--source=.', '--push'], dest));
    msg('green', 'github', `gh repo create ${slug} ${args.visibility.slice(2)} — pushed`);
    if (quiet('scripts/setup-governance.sh', [], dest)) msg('green', 'protected', 'branch protection + repo security applied');
    else msg('yellow', 'protected', `setup-governance.sh failed — run it in ${dest}`);
  }

  if (args.register) registerRepo(args, dest);
  else msg('dim', 'skipped', `registration (--no-register) — later: repo register ${slug}`);

  msg('dim', 'next', `rewrite bin/${slug} describe_spec · README · start "first change"`);
}

const handle: Handler = (argv, rt) => {
  const command = argv[0] ?? '';
  if (command === '') return usageError('repo needs a command: new or register (try -h)');
  if (command !== 'new' && command !== 'register') return rt.dieUnknown('command', command);

  const parsed = parseRepoArgs(argv.slice(1), (kind, token) => rt.dieUnknown(kind, token, command));
  if ('exit' in parsed) return parsed.exit;
  const args = parsed;

  if (!args.slug) return usageError(`${command} needs a slug (try -h)`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.slug)) return usageError(`slug must be kebab-case ([a-z0-9-]): ${args.slug}`);
  if (args.root !== 'assets' && args.root !== 'projects') return rt.dieUnknown('value', args.root, command);
  if (args.track !== 'bash' && args.track !== 'node') return rt.dieUnknown('value', args.track, command);

  if (!args.name) args.name = titleCase(args.slug);

  if (command === 'register') {
    let dir = args.path;
    if (!dir) {
      for (const candidate of [`${codeHome}/Assets/${args.slug}`, `${codeHome}/Projects/${args.slug}`]) {
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
          dir = candidate;
          break;
        }
      }
    }
    if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return die('register', `no repo at $CODE_HOME/{Assets,Projects}/${args.slug} (or --path)`, 1);
    if (args.dry) {
      msg('dim', 'dry-run', `would register ${dir} as '${args.slug}' (${args.category}) + hq sync`);
      return 0;
    }
    registerRepo(args, dir);
    return 0;
  }

  const starter = process.env['STARTER_HOME'] || `${codeHome}/Projects/cordon-starter`;
  if (!existsSync(starter) || !statSync(starter).isDirectory()) return die('new', `no cordon-starter checkout at ${starter} (set STARTER_HOME)`, 1);
  const dest = `${codeHome}/${args.root === 'assets' ? 'Assets' : 'Projects'}/${args.slug}`;
  if (existsSync(dest)) return die('new', `already exists: ${dest}`, 1);

  if (args.dry) {
    msg('dim', 'dry-run', `would create ${dest} from ${starter} (${args.track} track)`);
    if (!args.local) msg('dim', 'dry-run', `would 'gh repo create ${args.slug} ${args.visibility.slice(2)}' + branch protection`);
    if (args.register) msg('dim', 'dry-run', `would register '${args.slug}' (${args.category}) + hq sync`);
    return 0;
  }

  bootstrap(args, starter, dest);
  return 0;
};

export const tool: ToolDefinition = { spec, run: handle };

import { currentBranch, cutFresh, defaultBranch, freshName, git, uniqueCommits, worktreeDirty } from '../git/index.ts';
import { die, exit } from '../sdk/cli.ts';
import { blank, header, msg, palette } from '../sdk/output.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: 'start',
  description: 'Begin new work on a fresh branch off the default branch.',
  group: 'Workspace',
  order: 205,
  effect: 'local_write',
  network: true,
  synopsis: ['start [options] [slug]'],
  paras: [
    'The opening beat of the workspace loop (start -> work -> ship -> land -> resync). Run it before touching code, from inside the repo: it fetches origin, cuts a fresh branch off the current origin/<base>, and carries any uncommitted edits in the tree onto it, so neither you nor an agent ever commits onto main or piles onto a stale branch (the mistake that turns one change into a merge-conflict cleanup).',
    "Committed-but-unpushed work on the current branch is left where it is (start never moves committed history) and reported, so nothing is silently stranded. Pair it with ship: 'ship --check --go' to open the PR, 'land' to merge, 'resync' to reconcile.",
  ],
  options: [{ flags: ['--from'], metavar: 'BASE', help: "Branch off origin/BASE instead of the repo's default branch" }],
  positionals: [{ name: 'slug', help: 'Short name for the work; becomes the branch (kebab-cased). Omit for a timestamped name.' }],
  examples: [
    { command: 'start "fix dns rewrites"', comment: 'fresh branch fix-dns-rewrites off origin/main, carrying current edits' },
    { command: 'start --from develop hotfix', comment: 'branch hotfix off origin/develop' },
  ],
};

/** A branch-safe kebab slug; '' when nothing usable remains. */
export function slugify(text: string): string {
  return text
    .replace(/[A-Z]/g, (char) => char.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

const run: Handler = (args, rt) => {
  let base = '';
  let words = '';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--from') {
      if (i + 1 >= args.length) exit(1);
      base = args[i + 1] ?? '';
      i += 1;
    } else if (arg.startsWith('-')) rt.dieUnknown('option', arg);
    else words = words ? `${words} ${arg}` : arg;
  }

  const cwd = process.cwd();
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree']).ok) die('repo', 'not inside a git work tree — cd into the repo first', 2);

  header('start', 1);
  git(cwd, ['fetch', '-q', 'origin', '--prune']);
  if (!base) base = defaultBranch(cwd);

  if (!git(cwd, ['rev-parse', '--verify', '-q', `origin/${base}`]).ok) {
    die('base', `origin/${base} not found — is the remote reachable and the branch pushed?`, 1);
  }

  let slug = slugify(words);
  if (!slug) slug = freshName('work');
  if (git(cwd, ['show-ref', '--verify', '-q', `refs/heads/${slug}`]).ok) slug = freshName(slug);

  const cur = currentBranch(cwd);
  const left = uniqueCommits(cwd, base);
  const carried = worktreeDirty(cwd);

  const fresh = cutFresh(cwd, base, slug);
  if (fresh === null) die('branch', `could not cut '${slug}' off origin/${base}`, 1);

  const p = palette();
  msg('green', 'start', `${fresh} ${p.DIM}off origin/${base}${p.RESET}`);
  if (carried) msg('dim', 'carried', `uncommitted edits moved onto ${fresh}`);
  if (cur !== base && cur !== 'main' && cur !== 'master' && left !== 0) {
    msg('yellow', 'left', `${left} commit(s) on '${cur}' — not moved (cherry-pick them if you still want them)`);
  }
  msg('dim', 'next', 'edit · ship --check --go · land · resync');
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, run };

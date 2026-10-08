import {
  TARGET_OK,
  TARGET_STALE,
  behindCommits,
  commit,
  conventionalSubject,
  currentBranch,
  defaultBranch,
  ghBin,
  git,
  openOrUpdatePr,
  prBodySummary,
  printFailingChecks,
  pushCurrent,
  rebranch,
  targetBranch,
  uniqueCommits,
} from '../git/index.ts';
import { readFleet } from '../git/fleet.ts';
import { die, exit } from '../sdk/cli.ts';
import { blank, header, msg, palette } from '../sdk/output.ts';
import { run as runCommand, runInherit } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { shipGate } from './gate.ts';
import { shipRows } from './plan.ts';
import type { ShipRow } from './plan.ts';

export const spec: ToolSpec = {
  name: 'ship',
  description: 'Commit, push, and PR pending work — one repo, or the whole fleet.',
  group: 'Workspace',
  order: 210,
  effect: 'remote_write',
  network: true,
  synopsis: ['ship [options] [name] [-- paths...]'],
  paras: [
    "Preview with 'ship' or 'ship <name>'; execute with --go. A single repo needs no --all; a fleet ship requires --all so it can never happen by accident. Pass '-- path ...' to commit only those paths instead of everything. If you are on main (or a branch whose remote was merged and deleted) ship cuts a fresh 'ship/<timestamp>' branch off the default branch so main is never committed to and zombie branches are never pushed. The PR body defaults to a clean file summary; pass --body (or let an agent pass one) for a richer PR.",
    "--check runs the repo's local gate before pushing so a failure is caught here, not after a CI round-trip; a repo that fails its gate is left unpushed. --watch then follows the PR's checks to green or red instead of you polling by hand. Together they close the write half of the loop: gate locally, ship, watch CI, then 'resync' once it merges.",
    'ship is idempotent on an open PR, so iterating on one you review on GitHub is the same one command, not raw git. Re-run it after amending a commit and it re-pushes the branch with --force-with-lease and syncs the PR title to the (conventional) commit subject; the body is only rewritten when you pass --body, so a description you curated on GitHub is never clobbered.',
  ],
  options: [
    { flags: ['--go'], help: 'Actually commit/push/PR (default is a dry-run preview)' },
    { flags: ['--all'], help: 'Required to act on more than one repo (a guard against accidental fleet ships)' },
    { flags: ['-m', '--message'], metavar: 'MSG', help: 'PR title + commit message (default: derived from changed paths)' },
    { flags: ['--body'], metavar: 'BODY', help: 'PR body (default: a generated new/modified/removed file summary)' },
    { flags: ['--no-pr'], help: 'Commit and push only; do not open a PR' },
    {
      flags: ['--check'],
      help: "Run the repo's own local gate (tools check --ci / scripts/check.sh / npm test) before pushing; skip the repo if it fails",
    },
    { flags: ['--watch'], help: "After opening/updating the PR, poll 'gh pr checks' until CI is green or red" },
    {
      flags: ['--rebranch'],
      help: 'Recover a stale branch: replay its commits onto a fresh branch off origin/<base>, dropping any already merged (leaves the old branch untouched)',
    },
  ],
  positionals: [{ name: 'name', help: 'Only repos whose name contains NAME' }],
};

export interface ShipOptions {
  go: boolean;
  all: boolean;
  noPr: boolean;
  check: boolean;
  watch: boolean;
  rebranch: boolean;
  bodySet: boolean;
  message: string;
  body: string;
  name: string;
  paths: string[];
}

const SKIPPED = 3;
const BAD_TITLE = 2;
const WATCH_TRIES = 12;
const WATCH_PAUSE_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Previews what a repo's row would do, as the dry-run line. */
export function previewAction(row: ShipRow, noPr: boolean): string {
  const p = palette();
  const onMain = row.branch === 'main' || row.branch === 'master' || row.branch === '-';
  let action = '';
  if (row.uncommitted > 0) action += `commit ${row.uncommitted} · `;
  if (onMain) action += 'fresh branch · ';
  if (row.hasRemote) {
    action += 'push';
    if (row.ahead > 0) action += ` ↑${row.ahead}`;
  } else action += `${p.RED}no remote — skip${p.RESET}`;
  if (row.hasRemote && !noPr) action += ' · PR';
  return action;
}

// printf pads %-12s by bytes, so a multibyte label like the arrow gets less padding.
function plain(prefix: string, label: string, body: string, width: number): void {
  const p = palette();
  const pad = ' '.repeat(Math.max(0, width - Buffer.byteLength(label)));
  process.stdout.write(`  ${prefix}${label}${pad}${p.RESET} ${body}\n`);
}

async function watchChecks(row: ShipRow, url: string): Promise<void> {
  msg('dim', 'watch', 'polling gh pr checks…');
  const hasChecks = (): boolean => runCommand(ghBin(), ['pr', 'checks'], { cwd: row.path }).stdout.replace(/\n+$/, '') !== '';
  let tries = 0;
  while (!hasChecks() && tries < WATCH_TRIES) {
    await sleep(WATCH_PAUSE_MS);
    tries += 1;
  }
  if (!hasChecks()) msg('dim', 'watch', `${row.name}: no checks registered — nothing to watch`);
  else if (runCommand(ghBin(), ['pr', 'checks', '--watch', '--interval', '15'], { cwd: row.path }).ok) msg('green', 'green', `${row.name}: all checks passed`);
  else {
    msg('red', 'red', `${row.name}: checks failed — see ${url || 'the PR'}`);
    printFailingChecks(row.path);
  }
}

/** Ships one repo; returns 0 when shipped, 3 when skipped, 2 for a bad PR title. */
export async function shipRepo(row: ShipRow, opts: ShipOptions): Promise<number> {
  const p = palette();
  const cwd = row.path;
  git(cwd, ['fetch', '-q', 'origin', '--prune']);
  const base = defaultBranch(cwd);

  if (opts.rebranch) {
    const fresh = rebranch(cwd, base, 'ship');
    if (fresh === null) {
      msg('red', 'skip', `${row.name}: couldn't replay onto a fresh branch — a commit conflicts with already-merged work; rebase by hand: git rebase origin/${base}`);
      return SKIPPED;
    }
    msg('dim', 'rebranch', `replayed onto ${fresh} off origin/${base}`);
  } else {
    const target = targetBranch(cwd, base, 'ship');
    if (target.code === TARGET_STALE) {
      const cur = currentBranch(cwd);
      msg('yellow', 'stale', `${row.name}: on '${cur}' — behind origin/${base} by ${behindCommits(cwd, base)} · ${uniqueCommits(cwd, base)} committed commit(s) · no PR`);
      plain(p.DIM, '', 'shipping here would re-inherit work that may already be merged.', 12);
      plain(p.DIM, '→ start', `start "<slug>"           (clean branch off origin/${base}, then redo)`, 12);
      plain(p.DIM, '→ replay', `ship${opts.name ? ` ${opts.name}` : ''} --rebranch --go   (carry these commits onto a fresh branch)`, 12);
      return SKIPPED;
    }
    if (target.code !== TARGET_OK) {
      msg('red', 'skip', `${row.name}: could not branch off origin/${base}`);
      return SKIPPED;
    }
  }

  if (row.uncommitted > 0) commit(cwd, opts.message, opts.paths);

  if (opts.check) {
    const gate = shipGate(cwd);
    if (gate) {
      msg('dim', 'check', gate.join(' '));
      const [bin = '', ...gateArgs] = gate;
      if (runInherit(bin, gateArgs, { cwd }) !== 0) {
        msg('red', 'skip', `${row.name}: local gate failed — not pushed`);
        return SKIPPED;
      }
    } else msg('dim', 'check', `${row.name}: no local gate — pushing without one`);
  }

  if (!pushCurrent(cwd, true) && runInherit('git', ['push', '-q', '-u', '--force-with-lease', 'origin', 'HEAD'], { cwd }) !== 0) {
    msg('red', 'skip', `${row.name}: push failed — see the error above`);
    return SKIPPED;
  }

  if (opts.noPr) return 0;

  const title = opts.message || git(cwd, ['log', '-1', '--format=%s']).stdout.trim();
  if (!conventionalSubject(title)) {
    msg('red', 'skip', `${row.name}: PR title is not release-please friendly: ${title}`);
    msg('dim', 'hint', "rerun with -m 'feat: describe the change'");
    return BAD_TITLE;
  }
  const body = opts.body || prBodySummary(cwd, base);
  const url = openOrUpdatePr(cwd, base, title, body, opts.bodySet) ?? '';
  msg('green', 'PR', url || '(create failed — check gh auth)');

  if (opts.watch) await watchChecks(row, url);
  return 0;
}

export function parseShipArgs(args: readonly string[], onUnknown: (flag: string) => never): ShipOptions {
  const opts: ShipOptions = { go: false, all: false, noPr: false, check: false, watch: false, rebranch: false, bodySet: false, message: '', body: '', name: '', paths: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '--go') opts.go = true;
    else if (arg === '--all') opts.all = true;
    else if (arg === '--no-pr') opts.noPr = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--watch') opts.watch = true;
    else if (arg === '--rebranch') opts.rebranch = true;
    else if (arg === '-m' || arg === '--message' || arg === '--body') {
      if (i + 1 >= args.length) exit(1);
      const value = args[i + 1] ?? '';
      i += 1;
      if (arg === '--body') {
        opts.body = value;
        opts.bodySet = true;
      } else opts.message = value;
    } else if (arg === '--') {
      opts.paths = args.slice(i + 1);
      break;
    } else if (arg.startsWith('-')) onUnknown(arg);
    else opts.name = arg;
  }
  return opts;
}

const run: Handler = async (args, rt) => {
  const opts = parseShipArgs(args, (flag) => rt.dieUnknown('option', flag));

  if (opts.go && !opts.noPr && opts.message && !conventionalSubject(opts.message)) {
    die('message', 'PR title must be Conventional Commits / release-please friendly (example: feat: add repo dashboard)', 2);
  }

  const rows = shipRows(readFleet(opts.name ? [opts.name] : []), opts.name !== '' && !opts.noPr);

  if (rows.length === 0) {
    header('ship', 0);
    msg('green', 'clean', 'nothing to ship — every repo is committed and pushed');
    blank();
    return 0;
  }

  if (opts.go && rows.length > 1 && !opts.all) {
    header('ship', rows.length);
    for (const row of rows) msg('dim', 'pending', row.name);
    blank();
    return die('refuse', `${rows.length} repos pending — name one (\`ship <name> --go\`) or pass --all`, 2);
  }

  header('ship', rows.length);
  if (!opts.go) msg('yellow', 'preview', 'dry run — re-run with --go (single repo) or --all --go (fleet)');
  blank();

  let shipped = 0;
  let skipped = 0;
  for (const row of rows) {
    msg('dim', row.name, previewAction(row, opts.noPr));
    if (!opts.go || !row.hasRemote) continue;

    const rc = await shipRepo(row, opts);
    if (rc === 0) shipped += 1;
    else if (rc === SKIPPED) skipped += 1;
    else return rc;
  }

  blank();
  if (opts.go) {
    msg('green', 'shipped', `${shipped} repo(s)`);
    if (skipped > 0) msg('yellow', 'skipped', `${skipped} repo(s) — see the skip lines above`);
    if (shipped > 0) msg('dim', 'next', `land${opts.name ? ` ${opts.name}` : ''} once CI is green, then resync`);
  } else {
    msg('dim', 'next', opts.all ? 'ship --all --go' : 'ship <name> --go');
  }
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, run };

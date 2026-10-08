import { mergePr } from '../git/index.ts';
import type { MergeStrategy } from '../git/index.ts';
import { readFleet } from '../git/fleet.ts';
import { die } from '../sdk/cli.ts';
import { blank, header, msg } from '../sdk/output.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { isGreen, landRows } from './plan.ts';

export const spec: ToolSpec = {
  name: 'land',
  description: 'Merge a green PR and delete its branch — the merge beat of the loop.',
  group: 'Workspace',
  order: 215,
  effect: 'remote_write',
  network: true,
  synopsis: ['land [options] [name]'],
  paras: [
    "Preview with 'land' or 'land <name>'; execute with --go. A single repo needs no --all; a fleet land requires --all so it can never happen by accident. land reads the open-PR and CI state from 'repos --json --prs', so what it previews is exactly what 'repos --prs' shows. It merges the PR for the repo's current branch (the branch ship pushed), squash by default, and deletes the remote branch.",
    "A PR whose checks are not green is skipped with a note, not merged — pass --admin to override (solo repos, or landing ahead of CI). After a merge the branch is gone on GitHub; run 'resync <name>' to fast-forward the default branch locally and prune the merged branch. The loop closes there.",
  ],
  options: [
    { flags: ['--go'], help: 'Actually merge (default is a dry-run preview)' },
    { flags: ['--all'], help: 'Required to land more than one repo (a guard against accidental fleet merges)' },
    {
      flags: ['--admin'],
      help: 'Merge with gh pr merge --admin — bypass branch protection / required checks. For solo repos where you are the reviewer, or to land before CI is green.',
    },
    { flags: ['--merge'], help: 'Use a merge commit instead of the default squash' },
    { flags: ['--rebase'], help: 'Rebase-merge instead of the default squash' },
  ],
  positionals: [{ name: 'name', help: 'Only repos whose name contains NAME' }],
};

const run: Handler = (args, rt) => {
  let go = false;
  let all = false;
  let admin = false;
  let strategy: MergeStrategy = '--squash';
  let name = '';
  for (const arg of args) {
    if (arg === '--go') go = true;
    else if (arg === '--all') all = true;
    else if (arg === '--admin') admin = true;
    else if (arg === '--merge') strategy = '--merge';
    else if (arg === '--rebase') strategy = '--rebase';
    else if (arg.startsWith('-')) rt.dieUnknown('option', arg);
    else name = arg;
  }

  const rows = landRows(readFleet(['--prs', ...(name ? [name] : [])]));

  if (rows.length === 0) {
    header('land', 0);
    msg('green', 'clean', 'nothing to land — no open PRs');
    blank();
    return 0;
  }

  if (go && rows.length > 1 && !all) {
    header('land', rows.length);
    for (const row of rows) msg('dim', 'open PR', row.name);
    blank();
    return die('refuse', `${rows.length} open PRs — name one (\`land <name> --go\`) or pass --all`, 2);
  }

  header('land', rows.length);
  if (!go) msg('yellow', 'preview', 'dry run — re-run with --go (single repo) or --all --go (fleet)');
  if (admin) msg('yellow', 'admin', 'branch protection / required checks will be bypassed');
  blank();

  let landed = 0;
  for (const row of rows) {
    const green = isGreen(row.ci);
    const label = `PR #${row.number ?? ''} (${row.ci})`;
    if (green || admin) msg('dim', row.name, `${label} → merge ${strategy.slice(2)} + delete branch`);
    else {
      msg('yellow', row.name, `${label} — not green; skipped (use --admin to override)`);
      if (go) continue;
    }

    if (!go || !(green || admin)) continue;

    if (mergePr(row.path, strategy, admin).ok) {
      msg('green', 'merged', `${row.name}: PR #${row.number ?? ''} → ${row.url || 'merged'}`);
      landed += 1;
    } else {
      msg('red', 'skip', `${row.name}: merge failed (check gh auth / protection — try --admin)`);
    }
  }

  blank();
  if (go) {
    msg('green', 'landed', `${landed} PR(s)`);
    if (landed > 0) msg('dim', 'next', `resync${name ? ` ${name}` : ''} — reconcile the local tree`);
  } else {
    msg('dim', 'next', all ? 'land --all --go' : 'land <name> --go');
  }
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, run };

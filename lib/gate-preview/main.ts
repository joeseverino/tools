import { existsSync } from 'node:fs';
import path from 'node:path';
import { CliError, SilentExit, die } from '../sdk/cli.ts';
import { parseJson } from '../sdk/guards.ts';
import { blank, msg, palette } from '../sdk/output.ts';
import { codeHome, toolsHome } from '../sdk/paths.ts';
import { run } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { repoPaths, rowsOf, verdictOf } from './report.ts';

export const spec: ToolSpec = {
  name: 'gate-preview',
  description: 'See a cordon change\'s blast radius: run the engine across every gated repo before merging it.',
  group: 'Other',
  order: 240,
  effect: 'read',
  synopsis: ['gate-preview [options]'],
  paras: [
    'Answers \'what turns red if this cordon change ships?\' before it ships. Every fleet repo carrying a gate (a cordon.checks.json or scripts/check.sh) gets the named engine run over it with --json, and the verdicts land in one table: repo, ok, and the failed check ids. Repos are discovered from repos --json (the one read surface), so the preview and the cockpit can\'t disagree about what the fleet is. The engine runs read-only (never --fix); a red row here is a red gate after merge.',
  ],
  options: [
    {
      flags: ['--cordon'],
      metavar: 'DIR',
      help: 'Cordon checkout whose engine to run (default: the sibling Assets/cordon) — point it at a branch worktree to preview a proposed check change',
    },
    { flags: ['--json'], help: 'Machine-readable output: one object with a per-repo verdicts array' },
  ],
  examples: [{ command: 'gate-preview --cordon ~/wt/cordon-stricter-bats', comment: 'preview a branch\'s checks against the whole fleet' }],
};

/** The verdict text for a failing row, without its "RED " prefix. */
export function redDetail(verdict: string): string {
  return verdict.startsWith('RED ') ? verdict.slice(4) : verdict;
}

const handler: Handler = (args, rt) => {
  let cordonDir = path.join(codeHome, 'Assets', 'cordon');
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--cordon') {
      const value = args[index + 1];
      if (!value) throw new CliError('--cordon needs a path', 1);
      cordonDir = value;
      index += 1;
    } else if (arg === '--json') json = true;
    else rt.dieUnknown('flag', arg);
  }

  const engine = path.join(cordonDir, 'checks', 'run.ts');
  if (!existsSync(engine)) die('error', `no checks engine at ${engine} (pass --cordon <checkout>)`);

  const repos = run(path.join(toolsHome, 'bin', 'repos'), ['--json']);
  if (!repos.ok) {
    process.stderr.write(repos.stderr);
    throw new SilentExit(repos.code || 1);
  }
  const gated = repoPaths(parseJson(repos.stdout)).filter(
    (repo) => existsSync(path.join(repo, 'cordon.checks.json')) || existsSync(path.join(repo, 'scripts', 'check.sh')),
  );
  if (gated.length === 0) die('error', 'no gated repos found');

  const p = palette();
  const rows: string[] = [];
  let failTotal = 0;
  for (const repo of gated) {
    const name = path.basename(repo);
    const verdict = verdictOf(parseJson(run('node', [engine, '--root', repo, '--json']).stdout));
    if (verdict !== 'ok') failTotal += 1;
    rows.push(`${name}|${verdict}`);
    if (json) continue;
    if (verdict === 'ok') msg('green', 'ok', name);
    else msg('red', 'red', `${name} ${p.DIM}(${redDetail(verdict)})${p.RESET}`);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(rowsOf(rows))}\n`);
    return 0;
  }
  blank();
  if (failTotal) die('blast', `${failTotal} of ${gated.length} gated repos turn red under ${cordonDir}`, 1);
  msg('green', 'clear', `all ${gated.length} gated repos stay green under ${cordonDir}`);
  return 0;
};

export const tool: ToolDefinition = { spec, run: handler };

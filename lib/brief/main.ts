import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { toolsHome } from '../sdk/paths.ts';
import { run as runCommand, runInherit } from '../sdk/process.ts';
import { svmc } from '../sdk/svmc.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition, ToolRuntime } from '../sdk/tool.ts';

const DAYS_OPTION = { flags: ['--days'], metavar: 'DAYS', help: 'Vault recent-changes window in days (default 7)' } as const;

export const spec: ToolSpec = {
  name: 'brief',
  description: 'One emit-once snapshot of repos, vault, writeups, and any plugged-in section.',
  group: 'Workspace',
  order: 200,
  leafCommands: true,
  effect: 'read',
  network: true,
  synopsis: ['brief [options] | brief tui [options]'],
  options: [
    { flags: ['--json'], help: 'Machine-readable digest (one JSON object)' },
    {
      flags: ['--prs'],
      help: 'Include each repo\'s open PR (number, CI, review) and surface green PRs to land (network — folds in \'repos --prs\', the one PR owner)',
    },
    DAYS_OPTION,
  ],
  paras: [
    'Pure aggregator: it never re-implements a fact. Repo and PR state come from \'repos\' (--prs folds in \'repos --prs\', the one PR/CI owner — brief runs no gh of its own), and every vault fact (recent changes, docs to review, inbox) comes from \'severino-vault-mcp brief\' and \'list-writeups\' — the vault\'s one owner. Additional surfaces plug in as sections: each repository that declares a brief_section command in config/capabilities.json emits one section document — name, labelled lines, ranked queue rows, next-verb entries — that brief renders generically; the emitter\'s own repo owns every word of its content. Run \'brief\' to orient, \'brief --json\' for one parse of everything, \'brief tui\' for the cockpit. The \'next\' block names the loop verbs from the one classification: ship (dirty), land (green PR, with --prs), resync (merged), plus whatever plugged sections contribute.',
  ],
  examples: [
    { command: 'brief --prs', comment: 'morning orient with open-PR/CI state and the land verbs' },
    { command: 'brief tui', comment: 'the interactive workspace cockpit' },
  ],
  env: [{ name: 'SVMC_BIN', help: 'Override the severino-vault-mcp binary (tests stub it)' }],
  commands: [
    {
      name: 'tui',
      summary: 'Open the workspace cockpit — a ranked queue of what needs you, run ship/land/resync',
      effect: 'remote_write',
      network: true,
      interactive: true,
      options: [DAYS_OPTION],
      paras: [
        'The cockpit renders \'brief --json --prs\' as one severity-ranked action queue across every surface — green PRs to land, repos to ship, branches to resync, vault docs to review, writeup drafts — and runs the loop verbs (ship/land/resync/inbox) on the shared TUI runner. It reads the same digest as \'brief\' and never scans on its own; vault/writeup rows are reminders that copy a useful string. Enter copies, x runs, o opens a PR on GitHub, r refreshes.',
      ],
      examples: [{ command: 'brief tui', comment: 'open the workspace cockpit' }],
    },
  ],
};

export interface BriefArgs {
  json: boolean;
  prs: boolean;
  days: string;
  tui: boolean;
}

/** Parses brief's flags; `fail` reports an unknown token and does not return. */
export function parseBriefArgs(args: readonly string[], fail: (kind: string, token: string) => never): BriefArgs {
  const parsed: BriefArgs = { json: false, prs: false, days: '7', tui: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === 'tui' || arg === '--tui') parsed.tui = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--prs') parsed.prs = true;
    else if (arg === '--days') {
      parsed.days = args[index + 1] || '7';
      index += 1;
    } else if (arg.startsWith('-')) fail('option', arg);
    else fail('argument', arg);
  }
  return parsed;
}

/** The aggregate document render.ts reads; each part is already-serialized JSON. */
export function digestInput(parts: { repos: string; vault: string; writeups: string; sections: string }): string {
  return `{"repos":${parts.repos},"vault":${parts.vault},"writeups":${parts.writeups},"sections":${parts.sections}}`;
}

function stripTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, '');
}

// A failed emitter degrades to a fallback value; the digest never aborts on one.
function emit(bin: string, args: readonly string[], fallback: string): string {
  const result = runCommand(bin, [...args]);
  return result.ok ? stripTrailingNewlines(result.stdout) : fallback;
}

function svmcJson(args: readonly string[]): string {
  const result = svmc(args);
  return result.ok ? stripTrailingNewlines(result.stdout) : 'null';
}

const handler: Handler = (args, rt: ToolRuntime) => {
  const opts = parseBriefArgs(args, (kind, token) => rt.dieUnknown(kind, token));

  if (opts.tui) return runInherit('node', [path.join(toolsHome, 'lib', 'brief', 'tui.ts'), '--days', opts.days]);

  const input = digestInput({
    repos: emit('repos', opts.prs ? ['--json', '--prs'] : ['--json'], 'null'),
    vault: svmcJson(['brief', '--days', opts.days]),
    writeups: svmcJson(['list-writeups', '--filter', 'all']),
    sections: emit('node', [path.join(toolsHome, 'lib', 'tools', 'capabilities.ts'), 'run-all', 'brief_section'], '[]'),
  });
  const render = spawnSync('node', [path.join(toolsHome, 'lib', 'brief', 'render.ts'), opts.json ? 'json' : 'human', opts.prs ? '1' : '0'], {
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  return render.status ?? 1;
};

export const tool: ToolDefinition = { spec, run: handler };

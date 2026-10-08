import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { die } from '../sdk/cli.ts';
import { loadShellConfig } from '../sdk/config.ts';
import { blank, msg, palette } from '../sdk/output.ts';
import { run } from '../sdk/process.ts';
import { svmc } from '../sdk/svmc.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import { toolsHome } from '../sdk/paths.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { pullPush } from '../git/index.ts';
import { dailyRecord } from './daily-result.ts';
import { parseJson } from '../sdk/guards.ts';
import { syncFreshness } from '../hq/state.ts';
import { inboxCount, vaultRemote, vaultTree } from './state.ts';

export const spec: ToolSpec = {
  name: 'vault',
  description: 'Operations on the vault git repo.',
  group: 'Vault',
  order: 60,
  effect: 'read',
  synopsis: ['vault <command>'],
  env: [
    { name: 'NOTES_HOME', help: 'Read from ~/.zshrc; resolves VAULT' },
    { name: 'VAULT', help: 'Per-invocation override for the vault path' },
    { name: 'INBOX_DIR', help: 'Per-invocation override for the inbox folder' },
  ],
  commands: [
    { name: 'sync', summary: 'Pull and push the vault repo', effect: 'remote_write', network: true },
    {
      name: 'status',
      summary: 'Working tree, inbox count, remote sync state, and whether doc metadata changed since the last hq sync',
      effect: 'read',
      network: true,
    },
    { name: 'inbox', summary: 'List notes currently in the inbox', effect: 'read' },
    {
      name: 'daily',
      summary:
        "Populate the daily note's generated brief region from brief --json (work to ship, review-due docs, stale backlog, drafts) as Obsidian callouts — idempotent; never touches your free-capture area below the region",
      effect: 'vault_write',
      options: [{ flags: ['--date'], metavar: 'DATE', help: 'Daily note date (YYYY-MM-DD; default today)' }],
    },
  ],
};

interface VaultPaths {
  vault: string;
  inbox: string;
}

function vaultPaths(): VaultPaths {
  const config = loadShellConfig('vault', { scalars: ['VAULT', 'INBOX_DIR'] });
  return { vault: config.scalars['VAULT'] ?? '', inbox: config.scalars['INBOX_DIR'] ?? '' };
}

function isDirectory(target: string): boolean {
  return existsSync(target) && statSync(target).isDirectory();
}

function requireVault(vault: string): void {
  if (!isDirectory(vault)) die('error', `vault not found: ${vault}`);
  if (!isDirectory(path.join(vault, '.git'))) die('error', `not a git repo: ${vault}`);
}

function plural(count: number): string {
  return count === 1 ? '' : 's';
}

function sync(): number {
  const { vault } = vaultPaths();
  requireVault(vault);
  blank();
  if (pullPush(vault)) {
    msg('green', 'synced', 'pull --rebase + push');
  } else {
    msg('red', 'failed', 'sync — see git output above');
    blank();
    return 1;
  }
  blank();
  return 0;
}

function status(): number {
  const { vault, inbox } = vaultPaths();
  requireVault(vault);
  blank();

  const tree = vaultTree(vault);
  const pending = inboxCount(inbox);
  const remote = vaultRemote(vault);

  msg(tree === 'clean' ? 'green' : 'yellow', 'tree', tree);
  if (pending > 0) msg('yellow', 'inbox', `${pending} pending note${plural(pending)}`);
  else msg('green', 'inbox', 'empty');
  msg(remote === 'in sync' ? 'green' : 'yellow', 'remote', remote);

  const hq = syncFreshness(vault);
  switch (hq.kind) {
    case 'never': msg('yellow', 'hq', 'never synced — run `hq sync`'); break;
    case 'skip': break;
    case 'fresh': msg('green', 'hq', `in sync (last sync ${hq.date})`); break;
    case 'stale': msg('yellow', 'hq', `doc metadata changed since last sync (${hq.date}) — run \`hq sync\``); break;
  }
  blank();
  return 0;
}

function inboxList(): number {
  const { inbox } = vaultPaths();
  if (!isDirectory(inbox)) die('error', `inbox not found: ${inbox}`);
  blank();
  const notes = readdirSync(inbox)
    .filter((name) => name.endsWith('.md') && !name.startsWith('.') && statSync(path.join(inbox, name)).isFile())
    .sort();
  for (const note of notes) process.stdout.write(`  ${note.slice(0, -'.md'.length)}\n`);
  if (notes.length === 0) {
    msg('green', 'inbox', 'empty');
  } else {
    const p = palette();
    blank();
    process.stdout.write(`  ${p.BOLD}${notes.length} note${plural(notes.length)}${p.RESET}\n`);
  }
  blank();
  return 0;
}

function localDate(now: Date): string {
  const p = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The stdin document `daily-gather.ts` folds: the day, the fleet, and the task ledger. */
export function activityInput(day: string, reposJson: string, boardJson: string): string {
  return `{"date":"${day}","repos":${reposJson},"board":${boardJson}}`;
}

const daily: Handler = (args, rt) => {
  let date = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--date') {
      date = args[index + 1] ?? '';
      index += 1;
    } else if (arg.startsWith('-')) rt.dieUnknown('flag', arg, 'daily');
    else rt.dieUnknown('argument', arg, 'daily');
  }
  vaultPaths();
  blank();

  const day = date || localDate(new Date());
  const repos = run('repos', ['--json']);
  if (!repos.ok) die('error', 'repos --json failed');
  const board = run('backlog', ['--json', '--all']);
  const boardJson = board.ok ? board.stdout.replace(/\n+$/, '') : '{"tasks":[]}';

  const gather = run('node', [path.join(toolsHome, 'lib/brief/daily-gather.ts'), day], {
    input: activityInput(day, repos.stdout.replace(/\n+$/, ''), boardJson),
  });
  if (!gather.ok) die('error', "gathering the day's activity failed");
  const block = run('node', [path.join(toolsHome, 'lib/brief/daily.ts'), day], { input: gather.stdout });
  if (!block.ok) die('error', 'rendering the daily block failed');

  const written = svmc(['daily-write', ...(date ? ['--date', date] : [])], { input: block.stdout.replace(/\n+$/, '') });
  if (!written.ok) die('error', 'daily-write failed (is the MCP installed? site reinstall-mcp)');

  const [kind = '', detail = '', state = ''] = dailyRecord(parseJson(written.stdout)).split('\t');
  if (kind !== 'ok') die('error', `daily-write: ${detail}`);
  msg('green', 'daily', `${state} brief region → ${detail}`);
  blank();
  return 0;
};

export const tool: ToolDefinition = {
  spec,
  commands: {
    sync: () => sync(),
    status: () => status(),
    inbox: () => inboxList(),
    daily,
  },
  fallback: (args, rt) => {
    vaultPaths();
    return rt.dieUnknown('command', args[0] ?? '');
  },
};

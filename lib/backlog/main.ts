import { die } from '../sdk/cli.ts';
import { blank, msg } from '../sdk/output.ts';
import { parseJson } from '../sdk/guards.ts';
import { svmc } from '../sdk/svmc.ts';
import type { OptionSpec, ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition, ToolRuntime } from '../sdk/tool.ts';
import { renderTaskList } from './render.ts';
import { taskRecord } from './result.ts';

const json: OptionSpec = { flags: ['--json'], help: 'Machine-readable output' };
const status: OptionSpec = { flags: ['--status'], metavar: 'S', help: 'Filter by status' };
const project: OptionSpec = { flags: ['--project'], metavar: 'P', help: 'Filter by project' };
const all: OptionSpec = { flags: ['--all'], help: 'Include parked/done/wontfix' };

export const spec: ToolSpec = {
  name: 'backlog',
  description: "The fleet backlog — a thin client over the vault MCP's task brain.",
  group: 'Workspace',
  order: 225,
  leafCommands: true,
  effect: 'read',
  synopsis: ['backlog [board|list|stale] [options] | backlog add|move|close ...'],
  paras: [
    "backlog renders what the MCP emits and never re-derives it: 'severino-vault-mcp task-list' is the one brain (it indexes the vault, so there is no second scanner), and 'task-add'/'task-move' are the one writer (schema-validated, atomic). The board groups by project — each project's open work, plus the cross-cutting bucket — so the vault's project pages and this board show the same tasks. Status moves go through 'backlog move'/'close' so the task file changes in place and the board stays honest.",
    "A task lives with its project under 01 Projects/<project>/tasks/, or in 07 Backlog/ when it is cross-cutting or non-project. Run 'backlog' to see what's open, 'backlog stale' for the review nudge, 'backlog --json' to consume the ledger in one parse.",
  ],
  options: [
    { flags: ['--json'], help: 'Machine-readable output (the MCP\'s task-list JSON, "tasks" array)' },
    { flags: ['--status'], metavar: 'S', help: 'Only tasks with status S (open|active|parked|done|wontfix)' },
    { flags: ['--project'], metavar: 'P', help: 'Only tasks owned by or touching project P' },
    { flags: ['--stale'], help: 'Only stale tasks (open/active, untouched > N days)' },
    { flags: ['--all'], help: 'Include parked/done/wontfix (default shows only open + active)' },
    { flags: ['--days'], metavar: 'N', help: 'Stale window in days (default 14)' },
  ],
  examples: [
    { command: 'backlog', comment: 'the board: open + active work, grouped by project' },
    { command: 'backlog stale', comment: 'open/active tasks untouched > 14 days' },
    { command: 'backlog --project tools --json', comment: 'machine-read every tools task' },
    { command: 'backlog add "Fix the bats PATH trap" --project tools --effort S', comment: 'capture a task' },
    { command: 'backlog close backlog-cli', comment: 'mark it done (stamps closed:)' },
  ],
  env: [{ name: 'SVMC_BIN', help: 'Override the severino-vault-mcp binary (tests stub it)' }],
  commands: [
    {
      name: 'board',
      summary: 'The default board, grouped by project',
      effect: 'read',
      options: [json, status, project, { flags: ['--stale'], help: 'Only stale tasks' }, all],
    },
    { name: 'list', summary: 'Flat list view (same filters as the board)', effect: 'read', options: [json, status, project, all] },
    {
      name: 'stale',
      summary: 'Open/active tasks untouched past the stale window — the review nudge',
      effect: 'read',
      options: [{ flags: ['--days'], metavar: 'N', help: 'Stale window in days (default 14)' }, json],
    },
    {
      name: 'add',
      summary: 'Capture a new task (delegates to severino-vault-mcp task-add)',
      effect: 'vault_write',
      options: [
        { flags: ['--project'], metavar: 'P', help: 'Owning project — colocates at 01 Projects/<project>/tasks/' },
        { flags: ['--effort'], metavar: 'E', help: 'Effort S|M|L (default S)' },
        { flags: ['--priority'], metavar: 'P', help: 'Priority high|med|low (default med)' },
        { flags: ['--related-projects'], metavar: 'PROJECTS', help: 'Projects a cross-cutting task touches (space-separated)' },
      ],
      positionals: [{ name: 'title', variadic: true, help: 'Imperative task title (joined)' }],
    },
    {
      name: 'move',
      summary: 'Transition a task to a new status (stamps closed: on done)',
      effect: 'vault_write',
      positionals: [
        { name: 'id', help: 'Task id or slug (task-foo or foo)' },
        { name: 'status', help: 'Target status (open|active|parked|done|wontfix)' },
      ],
    },
    {
      name: 'close',
      summary: "Shorthand for 'move <id> done'",
      effect: 'vault_write',
      positionals: [{ name: 'id', help: 'Task id or slug' }],
    },
  ],
};

type Command = 'board' | 'list' | 'stale' | 'add' | 'move' | 'close';

function isCommand(value: string): value is Command {
  return ['board', 'list', 'stale', 'add', 'move', 'close'].includes(value);
}

/** The flags `add` forwards to task-add, plus the title words. */
export function parseAdd(args: readonly string[], onUnknown: (flag: string) => never): { flags: string[]; title: string[] } {
  const flags: string[] = [];
  const title: string[] = [];
  let index = 0;
  for (; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--project' || arg === '--effort' || arg === '--priority') {
      flags.push(arg, args[index + 1] ?? '');
      index += 1;
    } else if (arg === '--related-projects') {
      index += 1;
      while (index < args.length && !(args[index] ?? '').startsWith('-')) {
        flags.push('--related-projects', args[index] ?? '');
        index += 1;
      }
      index -= 1;
    } else if (arg === '--') {
      index += 1;
      break;
    } else if (arg.startsWith('-')) onUnknown(arg);
    else title.push(arg);
  }
  title.push(...args.slice(index));
  return { flags, title };
}

/** The MCP task-list flags for a read command. */
export function parseRead(
  command: Command,
  args: readonly string[],
  onUnknown: (kind: 'flag' | 'argument', token: string) => never,
): { json: boolean; flags: string[] } {
  const flags: string[] = command === 'stale' ? ['--stale-only'] : [];
  let asJson = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    switch (arg) {
      case '--json': asJson = true; break;
      case '--status': flags.push('--status', args[index + 1] ?? ''); index += 1; break;
      case '--project': flags.push('--project', args[index + 1] ?? ''); index += 1; break;
      case '--stale': flags.push('--stale-only'); break;
      case '--all': flags.push('--all'); break;
      case '--days': flags.push('--stale-days', args[index + 1] ?? ''); index += 1; break;
      default: onUnknown(arg.startsWith('-') ? 'flag' : 'argument', arg);
    }
  }
  return { json: asJson, flags };
}

function forward(stderr: string): void {
  if (stderr) process.stderr.write(stderr);
}

function write(command: Command, args: readonly string[], rt: ToolRuntime): number {
  let call: string[];
  if (command === 'add') {
    const { flags, title } = parseAdd(args, (flag) => rt.dieUnknown('flag', flag, 'add'));
    if (title.length === 0) die('usage', 'add needs a title (try -h)', 2);
    call = ['task-add', title.join(' '), ...flags];
  } else {
    const id = args[0] ?? '';
    if (id === '') die('usage', `${command} needs a task id (try -h)`, 2);
    const target = command === 'close' ? 'done' : (args[1] ?? '');
    if (target === '') die('usage', 'move needs a target status (try -h)', 2);
    call = ['task-move', id, target];
  }

  const result = svmc(call);
  forward(result.stderr);
  const { line, ok } = taskRecord(parseJson(result.stdout));
  const [, a = '', b = '', c = ''] = line.split('\t');
  blank();
  if (ok) msg('green', command === 'add' ? 'captured' : b, command === 'add' ? a : `${a}${c ? `  (was ${c})` : ''}`);
  else msg('red', 'error', line.slice('err\t'.length));
  blank();
  return ok ? result.code : 1;
}

function read(command: Command, args: readonly string[], rt: ToolRuntime): number {
  const { json: asJson, flags } = parseRead(command, args, (kind, token) => rt.dieUnknown(kind, token, command));
  const result = svmc(['task-list', ...flags]);
  forward(result.stderr);
  if (!result.ok) return result.code || 1;
  const body = result.stdout.replace(/\n+$/, '');
  if (asJson) {
    process.stdout.write(`${body}\n`);
    return 0;
  }
  const { text, code } = renderTaskList(command === 'board' ? 'board' : 'list', parseJson(body));
  process.stdout.write(text);
  return code;
}

const handler: Handler = (args, rt) => {
  const first = args[0] ?? '';
  let command: Command = 'board';
  let rest = args;
  if (isCommand(first)) {
    command = first;
    rest = args.slice(1);
  } else if (first !== '' && !first.startsWith('-')) return rt.dieUnknown('command', first);
  return command === 'add' || command === 'move' || command === 'close' ? write(command, rest, rt) : read(command, rest, rt);
};

export const tool: ToolDefinition = { spec, run: handler };

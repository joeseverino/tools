import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadShellFile } from '../sdk/config.ts';
import { blank, header, msg } from '../sdk/output.ts';
import { codeHome, toolsHome } from '../sdk/paths.ts';
import type { OptionSpec, ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import type { CollectOptions } from './collect.ts';
import { fetchPrs, scan } from './scan.ts';
import { buildRepo } from './record.ts';
import { renderTable } from './render.ts';

const PM_HELP = 'Only repos whose package manager is PM (pnpm|npm|yarn|bun|none)';
const SIZES_HELP = 'Include node_modules size (slower; runs du)';
const ICLOUD_HELP = "Count iCloud conflict duplicates ('name 2.ext') per repo";
const ROOT_HELP = 'Scan DIR instead of the defaults (repeatable)';

const tuiOptions: OptionSpec[] = [
  { flags: ['--dirty'], help: 'Start on repos with uncommitted changes' },
  { flags: ['--unpushed'], help: 'Start on repos with no remote, no upstream, unpushed commits, or gone upstream' },
  { flags: ['--fetch'], help: 'git fetch --prune each repo on load so behind/gone state is current' },
  { flags: ['--pm'], metavar: 'PM', help: PM_HELP },
  { flags: ['--sizes'], help: SIZES_HELP },
  { flags: ['--icloud'], help: ICLOUD_HELP },
  { flags: ['--root'], metavar: 'DIR', help: ROOT_HELP },
];

export const spec: ToolSpec = {
  name: 'repos',
  description: 'Fleet inventory of every repo under CODE_HOME.',
  group: 'Workspace',
  order: 190,
  leafCommands: true,
  effect: 'read',
  synopsis: ['repos [options] [name] | repos tui [options] [name]'],
  options: [
    { flags: ['--tui'], help: 'Open the interactive repo fleet explorer (can execute ship/land/resync actions)' },
    { flags: ['--json'], help: 'Machine-readable output (one JSON object, "repos" array)' },
    { flags: ['--dirty'], help: 'Only repos with uncommitted changes' },
    { flags: ['--unpushed'], help: 'Only repos with no remote, no upstream, or unpushed commits' },
    { flags: ['--prs'], help: "Fold each repo's open-PR state (number, CI, review) into the output via gh (network; one gh call per repo with a remote)" },
    {
      flags: ['--fetch'],
      help: 'git fetch --prune each repo before computing ahead/behind/gone, so the remote-tracking state is true now, not as of the last manual fetch (network; slower)',
    },
    { flags: ['--pm'], metavar: 'PM', help: PM_HELP },
    { flags: ['--sizes'], help: SIZES_HELP },
    { flags: ['--icloud'], help: ICLOUD_HELP },
    { flags: ['--root'], metavar: 'DIR', help: ROOT_HELP },
  ],
  positionals: [{ name: 'name', help: 'Only repos whose name contains NAME' }],
  paras: [
    "Default roots are $CODE_HOME/Assets and $CODE_HOME/Projects. A directory is listed if it is a git work tree or carries a project manifest (package.json, pyproject.toml, go.mod, Cargo.toml). Use 'repos --pm npm' to see what is left to migrate, 'repos --unpushed' before stepping away, and 'repos --json' to consume the whole fleet in one parse.",
    "repos owns the read half of the workspace loop; the write half reads back from it. 'repos --prs' adds the PR/CI state ship and land act on (it is what 'land' previews against), and 'repos --fetch' makes the behind/gone signal honest before you rely on it. The behind/upstream-gone counts without --fetch are only as fresh as the last fetch in that repo.",
  ],
  examples: [
    { command: 'repos tui', comment: 'open the fleet explorer' },
    { command: 'repos --unpushed --json', comment: 'machine-read repos needing push, upstream setup, or stale-branch cleanup' },
    { command: 'repos --prs --fetch --json', comment: 'the full honest snapshot: fresh behind/gone plus open-PR/CI state, in one parse' },
  ],
  commands: [
    {
      name: 'tui',
      summary: 'Open the interactive repo dashboard and run ship/land/resync/shell actions',
      effect: 'remote_write',
      network: true,
      interactive: true,
      options: tuiOptions,
      positionals: [{ name: 'name', optional: true, help: 'Only repos whose name contains NAME' }],
      paras: [
        "The TUI renders the same repos --json fleet snapshot, then launches the existing workflow owners instead of reimplementing them: ship handles commit/push/PR, land merges the green PR, resync handles merged-branch cleanup, and shell actions drop into the selected repo. It paints from the fast local snapshot first, then hydrates open-PR/CI state (repos --prs) in the background so startup stays instant.",
      ],
      examples: [{ command: 'repos tui', comment: 'start from the workspace dashboard' }],
    },
  ],
};

interface Flags {
  json: boolean;
  tui: boolean;
  prs: boolean;
  nameFilter: string;
  roots: string[];
  options: CollectOptions;
}

/** Parses argv the way every workflow driver passes it: flags and one name may interleave, the last name wins. */
export function parseFlags(args: readonly string[], dieUnknown: (token: string) => never, localOk: readonly string[]): Flags | { exit: number } {
  const flags: Flags = {
    json: false,
    tui: false,
    prs: false,
    nameFilter: '',
    roots: [],
    options: { fetch: false, sizes: false, icloud: false, pm: '', dirty: false, unpushed: false, localOk },
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    switch (arg) {
      case 'tui':
      case '--tui': flags.tui = true; break;
      case '--json': flags.json = true; break;
      case '--dirty': flags.options.dirty = true; break;
      case '--unpushed': flags.options.unpushed = true; break;
      case '--prs': flags.prs = true; break;
      case '--fetch': flags.options.fetch = true; break;
      case '--sizes': flags.options.sizes = true; break;
      case '--icloud': flags.options.icloud = true; break;
      case '--pm':
      case '--root': {
        const value = args[index + 1];
        if (value === undefined) return { exit: 1 };
        index += 1;
        if (arg === '--pm') flags.options.pm = value;
        else flags.roots.push(value);
        break;
      }
      default:
        if (arg.startsWith('-')) return dieUnknown(arg);
        flags.nameFilter = arg;
    }
  }
  return flags;
}

function tuiArgs(flags: Flags): string[] {
  const { options } = flags;
  return [
    ...(options.dirty ? ['--dirty'] : []),
    ...(options.unpushed ? ['--unpushed'] : []),
    ...(options.fetch ? ['--fetch'] : []),
    ...(options.sizes ? ['--sizes'] : []),
    ...(options.icloud ? ['--icloud'] : []),
    ...(options.pm ? ['--pm', options.pm] : []),
    ...flags.roots.flatMap((root) => ['--root', root]),
    ...(flags.nameFilter ? [flags.nameFilter] : []),
  ];
}

const run: Handler = async (args, rt) => {
  const localOk = loadLocalOk(process.env['REPOS_CONFIG']);
  const parsed = parseFlags(args, (token) => rt.dieUnknown('option', token), localOk);
  if ('exit' in parsed) return parsed.exit;
  const flags = parsed;
  if (flags.roots.length === 0) flags.roots.push(`${codeHome}/Assets`, `${codeHome}/Projects`);

  if (flags.tui) {
    const tui = spawnSync(process.execPath, [`${toolsHome}/lib/repos/tui.ts`, ...tuiArgs(flags)], { stdio: 'inherit' });
    return tui.status ?? 1;
  }

  const records = await scan({ roots: flags.roots, nameFilter: flags.nameFilter, options: flags.options });
  const prs = flags.prs && records.length > 0 ? await fetchPrs(records) : null;

  if (flags.json) {
    const repos = records.map((record, index) => buildRepo(record, { icloud: flags.options.icloud, pr: prs?.[index] ?? null }));
    process.stdout.write(`${JSON.stringify({ ok: true, roots: flags.roots, count: repos.length, repos })}\n`);
    return 0;
  }

  header('repos', records.length);
  if (records.length === 0) {
    msg('dim', 'none', 'no repos matched');
    blank();
    return 0;
  }
  process.stdout.write(renderTable(records, flags.prs ? prs : null));
  return 0;
};

function loadLocalOk(override: string | undefined): string[] {
  const file = override || `${toolsHome}/config/repos.sh`;
  if (!existsSync(file)) return [];
  return loadShellFile(file, { arrays: ['REPOS_LOCAL_OK'] }).arrays['REPOS_LOCAL_OK'] ?? [];
}

export const tool: ToolDefinition = { spec, run };

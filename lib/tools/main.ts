import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { die, exit } from '../sdk/cli.ts';
import { loadShellConfig } from '../sdk/config.ts';
import { blank, msg } from '../sdk/output.ts';
import { toolsHome } from '../sdk/paths.ts';
import { run, runInherit } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import { parsing } from '../sdk/tool.ts';
import type { Handler, ToolDefinition, ToolRuntime } from '../sdk/tool.ts';
import { runCheck } from './check.ts';
import { federate, prettify } from './federate.ts';
import { runDoctor } from './health.ts';
import { runInstall, runReinstall, toolNames } from './install.ts';
import { agentSource, launcher, scaffold, targetExists, toolSource } from './scaffold.ts';
import { runStatus } from './status.ts';

export { agentSource, launcher, toolSource };

export const spec: ToolSpec = {
  name: 'tools',
  description: 'Umbrella command for the personal CLI toolchain.',
  group: 'Core',
  order: 10,
  effect: 'read',
  synopsis: ['tools <command> [options]'],
  env: [
    { name: 'TOOLS_HOME', help: 'Set to this checkout for its children; how programs outside tools find it' },
    { name: 'TOOLS_INSTALL_DIR', help: 'Override install target (default: ~/.local/bin)' },
  ],
  commands: [
    {
      name: 'status',
      summary: 'One-screen health check across vault, inbox, and backup',
      effect: 'read',
      network: true,
      options: [{ flags: ['--json'], help: 'Machine-readable output (one JSON object)' }],
    },
    {
      name: 'doctor',
      summary: 'Verify environment, deps, and installed symlinks',
      effect: 'read',
      network: true,
      options: [
        { flags: ['--all'], help: 'Cross-system rollup: also run hq doctor (exit 1 if any gate fails)' },
        { flags: ['--live'], help: 'Implies --all; also ask HQ what it claims is wrong (hq call get_findings, over SSH); exit 1 on any finding' },
        { flags: ['--json'], help: 'Machine-readable output (one object, "checks" array)' },
      ],
    },
    {
      name: 'check',
      summary: 'Run the full CI suite locally: lint, tests, bench',
      effect: 'local_write',
      options: [
        { flags: ['--no-bench'], help: 'Skip the bench scripts (the slowest step)' },
        {
          flags: ['--ci'],
          help: "Run hermetically, as CI does: this checkout's bin first with the install dir off $PATH (no stale shadow), an empty global/system git config (no leaked defaultBranch, aliases, or hooks), and the bats version surfaced. ship --check uses this mode; set TOOLS_CI_BATS_VERSION to fail on a bats version other than CI's.",
        },
      ],
    },
    {
      name: 'new',
      summary: 'Scaffold a new tool in bin/ with the house conventions',
      effect: 'local_write',
      positionals: [{ name: 'name', help: 'Name of the new tool (creates bin/<name>)' }],
      options: [
        { flags: ['--agent'], help: 'Scaffold a lightweight agent-facing tool that emits the versioned result envelope' },
        { flags: ['--verify'], help: 'Generate derived surfaces and run the full non-benchmark check after scaffolding' },
      ],
    },
    { name: 'install', summary: 'Create symlinks in $INSTALL_DIR for every tool', effect: 'local_write' },
    {
      name: 'describe',
      summary: 'Emit the command surface of every tool as one JSON document (the emit-once contract)',
      effect: 'read',
      positionals: [
        { name: 'tool', optional: true, help: 'Describe just one tool (delegates to <tool> --describe)' },
        { name: 'command', optional: true, help: 'With a tool, project its contract to one command, the token-minimal AI path (tools describe hq sync)' },
      ],
      options: [
        { flags: ['--pretty'], help: 'Indent the JSON for reading (default: compact, diff-stable)' },
        { flags: ['--repos'], help: "Also fold in sibling repos' emitters (severino-vault-mcp, life)" },
        {
          flags: ['--tui'],
          help: "Browse the whole toolchain in a full-screen explorer (aggregate only; / filters, Enter copies an invocation). Shorthand: 'tools tui'",
        },
      ],
      examples: [
        { command: 'tools describe hq sync', comment: "one command's contract: effect, args, examples" },
        { command: 'tools tui', comment: 'interactive explorer over the whole toolchain (alias of describe --tui)' },
      ],
    },
    {
      name: 'tui',
      summary: "Open the full-screen command-surface explorer (shorthand for 'describe --tui')",
      effect: 'read',
      interactive: true,
      options: [{ flags: ['--repos'], help: "Also fold in sibling repos' emitters (severino-vault-mcp, life)" }],
      paras: [
        "The human tier of the emit-once contract: a two-pane explorer over every tool and command, with / to filter, e to expand the selected command's full prose + examples, and Enter to copy a ready-to-paste invocation.",
      ],
    },
    {
      name: 'generate',
      summary: 'Regenerate contract-derived completions and README reference/inventory',
      effect: 'local_write',
      positionals: [{ name: 'target', optional: true, choices: ['all', 'completions', 'readme'], help: 'Generated surface (default: all)' }],
      options: [{ flags: ['--check'], help: 'Fail when generated files are stale; do not write' }],
    },
    {
      name: 'contracts',
      summary: 'Inspect the producer → consumer contract graph and projection drift',
      effect: 'read',
      positionals: [{ name: 'id', optional: true, help: 'Contract or projection id to inspect (default: complete graph)' }],
      options: [
        { flags: ['--check'], help: 'Run every declared projection check and fail when any derived artifact is stale' },
        { flags: ['--json'], help: 'Emit the graph, source fingerprints, and projection status as JSON' },
        { flags: ['--scope'], metavar: 'SCOPE', choices: ['local', 'fleet', 'live'], help: 'Maximum projection scope to inspect (default: fleet)' },
      ],
      paras: [
        'Contracts are declared once in config/contracts.json. Owners emit source facts; consumers declare check and repair commands. This command discovers repository paths through the capability registry and never maintains a second fleet inventory.',
      ],
    },
    {
      name: 'derive',
      summary: 'Regenerate a declared consumer projection from its owner contract',
      effect: 'local_write',
      positionals: [{ name: 'projection', optional: true, help: 'Projection id from tools contracts (omit only with --all)' }],
      options: [
        { flags: ['--all'], help: 'Plan every repairable projection in scope; required for a batch' },
        { flags: ['--go'], help: "Execute the plan, then run each projection's declared check" },
        { flags: ['--json'], help: 'Emit the plan or execution receipts as JSON' },
        { flags: ['--scope'], metavar: 'SCOPE', choices: ['local', 'fleet'], help: 'Maximum projection scope to derive (default: local)' },
      ],
      paras: ['Dry-run by default. Repairs are schema-limited to local writes and execute only owner-declared commands; remote writes and deploys cannot enter this generic path.'],
    },
    {
      name: 'reinstall',
      summary: 'Reinstall a registered uv tool from its checkout and verify it matches the source',
      effect: 'local_write',
      network: true,
      positionals: [{ name: 'repo', optional: true, help: 'Repository id from config/capabilities.json (default: every repo that declares an install)' }],
      paras: [
        "Runs each repository's declared install command, then compares the installed fingerprint with one computed from the checkout wherever the repository declares a fingerprint. A mismatch fails, so a stale install cannot pass for current.",
      ],
      examples: [{ command: 'tools reinstall severino-vault-mcp', comment: 'reinstall the vault MCP and verify it against source' }],
    },
  ],
};

interface Layout {
  vault: string;
  inbox: string;
  backupsHome: string;
}

// Each config asserts its layout variable, so it is read only when that variable
// is set; doctor then reports what is missing instead of dying at startup.
function layout(): Layout {
  let vault = process.env['VAULT'] ?? '';
  let inbox = process.env['INBOX_DIR'] ?? '';
  if (process.env['NOTES_HOME']) {
    const config = loadShellConfig('vault', { scalars: ['VAULT', 'INBOX_DIR'] });
    vault = config.scalars['VAULT'] ?? vault;
    inbox = config.scalars['INBOX_DIR'] ?? inbox;
  }
  return { vault, inbox, backupsHome: process.env['BACKUPS_HOME'] ?? '' };
}

const status: Handler = (args) => {
  const { vault, inbox, backupsHome } = layout();
  return runStatus({ vault, inbox, backupsHome }, args[0] === '--json');
};

function unknownOption(rt: ToolRuntime, args: readonly string[], command: string, allowed: readonly string[]): void {
  for (const arg of args) if (!allowed.includes(arg)) rt.dieUnknown('option', arg, command);
}

const doctor: Handler = async (args, rt) => {
  unknownOption(rt, args, 'doctor', ['--json', '--all', '--live']);
  const { vault, inbox } = layout();
  const live = args.includes('--live');
  return runDoctor({ json: args.includes('--json'), all: args.includes('--all') || live, live, names: toolNames(), vault, inbox });
};

function checkRun(args: readonly string[], rt: ToolRuntime): number {
  unknownOption(rt, args, 'check', ['--no-bench', '--ci']);
  return runCheck({ bench: !args.includes('--no-bench'), ci: args.includes('--ci') });
}

const check: Handler = (args, rt) => checkRun(args, rt);

function generateRun(args: readonly string[], rt: ToolRuntime): number {
  let target = 'all';
  let checkOnly = false;
  for (const arg of args) {
    if (arg === '--check') checkOnly = true;
    else if (['all', 'completions', 'readme'].includes(arg)) target = arg;
    else if (arg.startsWith('-')) rt.dieUnknown('option', arg, 'generate');
    else rt.dieUnknown('target', arg, 'generate');
  }
  return runInherit('node', [path.join(toolsHome, 'lib/tools/generate-surfaces.ts'), target, ...(checkOnly ? ['--check'] : [])]);
}

const generate: Handler = (args, rt) => generateRun(args, rt);

const contracts: Handler = (args, rt) => {
  const forwarded: string[] = [];
  let id = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--check' || arg === '--json') forwarded.push(arg);
    else if (arg === '--scope') {
      const scope = args[index + 1];
      if (!scope) die('usage', 'tools contracts --scope <local|fleet|live>', 2);
      forwarded.push(arg, scope);
      index += 1;
    } else if (arg.startsWith('-')) rt.dieUnknown('option', arg, 'contracts');
    else {
      if (id) die('usage', 'tools contracts accepts one contract or projection id', 2);
      id = arg;
      forwarded.push(arg);
    }
  }
  return runInherit('node', [path.join(toolsHome, 'lib/tools/contracts.ts'), ...forwarded]);
};

const derive: Handler = (args) => runInherit('node', [path.join(toolsHome, 'lib/tools/derive.ts'), ...args]);

const install: Handler = () => runInstall(toolNames());

const reinstall: Handler = (args, rt) => {
  const first = args[0];
  if (first?.startsWith('-')) rt.dieUnknown('option', first, 'reinstall');
  return runReinstall(first);
};

const newTool: Handler = async (args, rt) => {
  const { values, positionals } = parsing(
    rt,
    () => parseArgs({ args: [...args], options: { agent: { type: 'boolean' }, verify: { type: 'boolean' } }, allowPositionals: true, strict: true }),
    'new',
  );
  const name = positionals.at(-1) ?? '';
  if (!name) die('usage', 'tools new <name> [--agent] [--verify] (try -h)', 2);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) die('usage', 'name must be lowercase letters, digits, dashes', 2);
  if (targetExists(toolsHome, name)) die('error', `bin/${name} already exists`);

  const agent = values.agent === true;
  const verify = values.verify === true;
  const described = await federate({ names: toolNames(), withSiblings: false });
  scaffold(toolsHome, name, agent, described);

  blank();
  msg('green', 'created', agent ? `bin/${name} (agent result-v1 template)` : `bin/${name}`);
  msg('green', 'created', `lib/${name}/main.ts`);
  if (!agent) msg('dim', 'next', `1. implement it (tool-specific files go in lib/${name}/)`);
  if (verify) {
    if (!agent) msg('dim', 'verify', 'generating surfaces and running tools check --no-bench');
    const generated = generateRun(['all'], rt);
    if (generated !== 0) return generated;
    const checked = checkRun(['--no-bench'], rt);
    if (checked !== 0) return checked;
    if (!agent) msg('dim', 'next', 'tools install');
  } else if (agent) msg('dim', 'next', 'implement the handler, then tools generate && tools check');
  else {
    msg('dim', 'next', '2. tools generate && tools install');
    msg('dim', 'next', '3. tools check');
  }
  blank();
  return 0;
};

const describe: Handler = async (args, rt) => {
  let pretty = false;
  let repos = false;
  let tui = false;
  let only = '';
  let onlyCommand = '';
  for (const arg of args) {
    if (arg === '--pretty') pretty = true;
    else if (arg === '--repos') repos = true;
    else if (arg === '--tui') tui = true;
    else if (arg.startsWith('-')) rt.dieUnknown('option', arg, 'describe');
    else if (!only) only = arg;
    else onlyCommand = arg;
  }

  if (tui) {
    if (only) die('usage', `--tui describes the whole toolchain; drop the tool name ('${only}' stays '${only} -h')`, 2);
    return runInherit('node', [path.join(toolsHome, 'lib/tools/describe-tui.ts'), ...(repos ? ['--repos'] : [])]);
  }

  const binary = path.join(toolsHome, 'bin', only);
  const executable = only !== '' && existsSync(binary) && (statSync(binary).mode & 0o111) !== 0;
  if (only && onlyCommand) {
    if (!executable) die('error', `no such tool: ${only}`);
    const described = run(binary, ['--describe']);
    if (!described.ok) return exit(described.code || 1);
    const contract: unknown = JSON.parse(described.stdout);
    const projected = projectCommand(contract, onlyCommand);
    process.stdout.write(`${pretty ? JSON.stringify(projected, null, 2) : JSON.stringify(projected)}\n`);
    return projected['ok'] === true ? 0 : 1;
  }
  if (only) {
    if (!executable) die('error', `no such tool: ${only}`);
    return runInherit(binary, ['--describe', ...(pretty ? ['--pretty'] : [])]);
  }

  const body = await federate({ names: toolNames(), withSiblings: repos });
  process.stdout.write(`${pretty ? prettify(body) : body}\n`);
  return 0;
};

function projectCommand(contract: unknown, want: string): Record<string, unknown> {
  const doc = typeof contract === 'object' && contract !== null ? (contract as Record<string, unknown>) : {};
  const commands = Array.isArray(doc['commands']) ? doc['commands'] : [];
  const found = commands.find((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>)['name'] === want);
  if (!found) {
    const names = commands.map((entry) => (typeof entry === 'object' && entry !== null ? String((entry as Record<string, unknown>)['name']) : ''));
    return { ok: false, error: `${String(doc['name'])} has no command '${want}'; commands: ${names.length ? names.join(', ') : '(none)'}` };
  }
  return { ok: true, schema_version: doc['schema_version'] ?? null, tool: doc['name'] ?? null, ...found };
}

const tui: Handler = (args, rt) => describe(['--tui', ...args], rt);

export const tool: ToolDefinition = {
  spec,
  commands: { status, doctor, check, new: newTool, install, describe, tui, generate, contracts, derive, reinstall },
};

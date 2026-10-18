// Runtime for a typed tool: help and --describe interception, the deploy
// confirmation gate, command dispatch, and the shared usage-error output.
import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { CliError, SilentExit, die, exit, reportError } from './cli.ts';
import { errorMessage } from './guards.ts';
import { blank, msg, palette } from './output.ts';
import { toolsHome } from './paths.ts';
import { findCommand, renderContract, scopeOf, serializeContract } from './surface.ts';
import type { ToolSpec } from './surface.ts';
import { renderUsage, renderUsageFor, terminalWidth } from './usage.ts';

export interface ToolRuntime {
  readonly spec: ToolSpec;
  usage(command?: string): string;
  /** Print help (the focused screen when a command is named) to stdout. */
  printUsage(command?: string): void;
  /** Unknown flag, command or value: print the error and the valid surface, exit 2. */
  dieUnknown(kind: string, token: string, command?: string): never;
}

export type Handler = (args: readonly string[], rt: ToolRuntime) => number | Promise<number>;

export interface ToolDefinition {
  spec: ToolSpec;
  /** Tools without commands, and leafCommands tools, parse their whole argv here. */
  run?: Handler;
  commands?: Readonly<Record<string, Handler>>;
  /** Runs for a first argument that is not a declared command. */
  fallback?: Handler;
}

export function isToolDefinition(value: unknown): value is ToolDefinition {
  return typeof value === 'object' && value !== null && 'spec' in value && typeof value.spec === 'object' && value.spec !== null && 'name' in value.spec;
}

export function createRuntime(spec: ToolSpec): ToolRuntime {
  const usage = (command = ''): string => (command ? renderUsageFor(spec, command, terminalWidth()) : renderUsage(spec, terminalWidth()));
  return {
    spec,
    usage,
    printUsage: (command) => void process.stdout.write(usage(command)),
    dieUnknown(kind, token, command = '') {
      blank();
      msg('red', 'usage', `unknown ${kind}: ${token}`);
      process.stdout.write(usage(command));
      return exit(2);
    },
  };
}

/** Spec commands and handlers must name the same set. */
export function definitionDrift(def: ToolDefinition): string[] {
  const declared = new Set((def.spec.commands ?? []).map((command) => command.name));
  const wired = new Set(Object.keys(def.commands ?? {}));
  const problems: string[] = [];
  if (declared.size && !def.spec.leafCommands) {
    for (const name of declared) if (!wired.has(name)) problems.push(`${def.spec.name}: command '${name}' has no handler`);
    for (const name of wired) if (!declared.has(name)) problems.push(`${def.spec.name}: handler '${name}' is not in the spec`);
  }
  if (!declared.size && !def.run) problems.push(`${def.spec.name}: a tool without commands needs run`);
  return problems;
}

function readTtyLine(): string {
  const fd = openSync('/dev/tty', 'r');
  try {
    const byte = Buffer.alloc(1);
    let line = '';
    while (readSync(fd, byte, 0, 1, null) === 1) {
      const char = byte.toString('utf8');
      if (char === '\n') break;
      line += char;
    }
    return line;
  } finally {
    closeSync(fd);
  }
}

/** A deploy-class scope needs a confirmation; TOOLS_ASSUME_YES or --yes skips it. */
export function confirmDeploy(spec: ToolSpec, command: string, args: readonly string[]): void {
  if (scopeOf(spec, command).effect !== 'deploy') return;
  if (process.env['TOOLS_ASSUME_YES'] || args.includes('--yes')) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    die('blocked', `'${spec.name} ${command}' is a deploy — set TOOLS_ASSUME_YES=1 to run non-interactively`, 2);
  }
  const p = palette();
  const tty = openSync('/dev/tty', 'w');
  try {
    writeSync(tty, `  ${p.YELLOW}${p.BOLD}${'confirm'.padEnd(10)}${p.RESET} ${spec.name} deploys to prod (${spec.name} ${command}). Continue? [y/N] `);
  } finally {
    closeSync(tty);
  }
  let reply = '';
  try {
    reply = readTtyLine();
  } catch {
    reply = '';
  }
  if (!['y', 'Y', 'yes', 'YES'].includes(reply)) die('aborted', 'deploy cancelled', 130);
}

export type Interception = { handled: true } | { handled: false; command: string; leaf: boolean };

/**
 * The help, --describe and deploy-gate layer every tool shares. Prints and reports
 * `handled` for a help or contract request; otherwise runs the gate for the
 * resolved scope and returns which command (or the leaf itself) to dispatch.
 */
export function intercept(spec: ToolSpec, argv: readonly string[]): Interception {
  const rt = createRuntime(spec);
  const [first = '', second = ''] = argv;

  if (first === '-h' || first === '--help') {
    rt.printUsage();
    return { handled: true };
  }
  if (first === '--describe') {
    process.stdout.write(serializeContract(renderContract(spec), argv.includes('--pretty')));
    return { handled: true };
  }

  const commands = spec.commands ?? [];
  if (commands.length === 0 || spec.leafCommands) {
    const named = commands.length > 0 && first !== '' && findCommand(spec, first) !== undefined;
    if (named && (second === '-h' || second === '--help')) {
      rt.printUsage(first);
      return { handled: true };
    }
    confirmDeploy(spec, named ? first : '', argv);
    return { handled: false, command: named ? first : '', leaf: true };
  }

  if (first === '' || first === 'help') {
    rt.printUsage();
    return { handled: true };
  }
  if (second === '-h' || second === '--help') {
    rt.printUsage(first);
    return { handled: true };
  }
  confirmDeploy(spec, first, argv);
  return { handled: false, command: first, leaf: false };
}

export async function runDefinition(def: ToolDefinition, argv: readonly string[]): Promise<void> {
  const rt = createRuntime(def.spec);
  const decision = intercept(def.spec, argv);
  if (decision.handled) return;

  if (decision.leaf) {
    if (!def.run) throw new CliError(`${def.spec.name}: no handler`, 1);
    process.exitCode = await def.run(argv, rt);
    return;
  }
  const handler = def.commands?.[decision.command];
  if (handler) {
    process.exitCode = await handler(argv.slice(1), rt);
    return;
  }
  if (def.fallback) {
    process.exitCode = await def.fallback(argv, rt);
    return;
  }
  return rt.dieUnknown('command', decision.command);
}

/** Entry point for a launcher: runs the tool and maps failures to exit codes. */
export async function runTool(def: ToolDefinition, argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  process.env['TOOLS_HOME'] = toolsHome;
  const problems = definitionDrift(def);
  try {
    if (problems.length) throw new CliError(problems.join('\n'), 70);
    await runDefinition(def, argv);
  } catch (error) {
    if (error instanceof SilentExit || error instanceof CliError) return reportError(error);
    reportError(new CliError(errorMessage(error), 1), 1);
  }
}

/** Runs a util.parseArgs call; an unknown flag becomes the shared usage error. */
export function parsing<R>(rt: ToolRuntime, parse: () => R, command = ''): R {
  try {
    return parse();
  } catch (error) {
    const unknown = /^Unknown option '([^']+)'/.exec(errorMessage(error));
    if (unknown?.[1]) return rt.dieUnknown('option', unknown[1], command);
    throw error;
  }
}

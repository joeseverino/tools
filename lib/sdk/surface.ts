// Typed command surface: the one declaration a tool makes. Help screens and the
// --describe JSON (Cordon schema_version 4) both render from it.
import { isRecord } from './guards.ts';

export const SCHEMA_VERSION = 4;

export const EFFECTS = ['read', 'local_write', 'vault_write', 'remote_write', 'deploy'] as const;
export type Effect = (typeof EFFECTS)[number];

export function isEffect(value: unknown): value is Effect {
  return typeof value === 'string' && (EFFECTS as readonly string[]).includes(value);
}

export interface OptionSpec {
  /** Short flag first by convention; the renderer orders short before long. */
  flags: readonly string[];
  help: string;
  metavar?: string;
  choices?: readonly string[];
  repeatable?: boolean;
}

export interface PositionalSpec {
  name: string;
  help: string;
  optional?: boolean;
  variadic?: boolean;
  choices?: readonly string[];
}

export interface ExampleSpec {
  command: string;
  comment?: string;
}

export interface EnvSpec {
  name: string;
  help: string;
}

interface ScopeSpec {
  effect: Effect;
  network?: boolean;
  interactive?: boolean;
  options?: readonly OptionSpec[];
  positionals?: readonly PositionalSpec[];
  paras?: readonly string[];
  examples?: readonly ExampleSpec[];
}

export interface CommandSpec extends ScopeSpec {
  name: string;
  summary: string;
  /** Owner of this command's flags when they are declared in another repo. */
  delegates?: string;
}

export interface ToolSpec extends ScopeSpec {
  name: string;
  description: string;
  group: string;
  order: number;
  synopsis?: readonly string[];
  env?: readonly EnvSpec[];
  /** Commands are discoverable aliases; bare invocation stays tool-owned. */
  leafCommands?: boolean;
  commands?: readonly CommandSpec[];
}

export interface ContractOption {
  name: string;
  positional: false;
  required: false;
  help: string;
  flags: string[];
  takes_value: boolean;
  metavar?: string;
  choices?: string[];
  repeatable?: true;
}

export interface ContractPositional {
  name: string;
  positional: true;
  required: boolean;
  help: string;
  choices?: string[];
  variadic?: true;
}

export type ContractArg = ContractOption | ContractPositional;

export interface ContractCommand {
  name: string;
  summary: string;
  args: ContractArg[];
  effect: Effect;
  network?: true;
  interactive?: true;
  paras: string[];
  examples: { command: string; comment: string }[];
  delegates?: string;
}

export interface Contract {
  ok: true;
  schema_version: typeof SCHEMA_VERSION;
  name: string;
  description: string;
  group: string;
  order: number;
  effect: Effect;
  network?: true;
  interactive?: true;
  global_options: ContractOption[];
  positionals: ContractPositional[];
  paras: string[];
  examples: { command: string; comment: string }[];
  commands: ContractCommand[];
}

export function shortFlag(option: OptionSpec): string {
  return option.flags.find((flag) => /^-[^-]$/.test(flag)) ?? '';
}

export function longFlag(option: OptionSpec): string {
  return option.flags.find((flag) => flag.startsWith('--')) ?? '';
}

export function optionName(option: OptionSpec): string {
  return longFlag(option) || shortFlag(option);
}

export function takesValue(option: OptionSpec): boolean {
  return Boolean(option.metavar) || (option.choices?.length ?? 0) > 0;
}

function contractOption(option: OptionSpec): ContractOption {
  const out: ContractOption = {
    name: optionName(option),
    positional: false,
    required: false,
    help: option.help,
    flags: [shortFlag(option), longFlag(option)].filter(Boolean),
    takes_value: takesValue(option),
  };
  if (option.metavar) out.metavar = option.metavar;
  if (option.choices?.length) out.choices = [...option.choices];
  if (option.repeatable) out.repeatable = true;
  return out;
}

function contractPositional(positional: PositionalSpec): ContractPositional {
  const out: ContractPositional = {
    name: positional.name,
    positional: true,
    required: !positional.optional,
    help: positional.help,
  };
  if (positional.choices?.length) out.choices = [...positional.choices];
  if (positional.variadic) out.variadic = true;
  return out;
}

function contractExamples(examples: readonly ExampleSpec[] | undefined): { command: string; comment: string }[] {
  return (examples ?? []).map((example) => ({ command: example.command, comment: example.comment ?? '' }));
}

function tags(scope: { network?: boolean; interactive?: boolean }): { network?: true; interactive?: true } {
  return { ...(scope.network ? { network: true as const } : {}), ...(scope.interactive ? { interactive: true as const } : {}) };
}

function contractCommand(command: CommandSpec): ContractCommand {
  return {
    name: command.name,
    summary: command.summary,
    args: [...(command.positionals ?? []).map(contractPositional), ...(command.options ?? []).map(contractOption)],
    effect: command.effect,
    ...tags(command),
    paras: [...(command.paras ?? [])],
    examples: contractExamples(command.examples),
    ...(command.delegates ? { delegates: command.delegates } : {}),
  };
}

/** Pure projection of a tool spec to the schema_version 4 document. */
export function renderContract(spec: ToolSpec): Contract {
  return {
    ok: true,
    schema_version: SCHEMA_VERSION,
    name: spec.name,
    description: spec.description,
    group: spec.group,
    order: spec.order,
    effect: spec.effect,
    ...tags(spec),
    global_options: (spec.options ?? []).map(contractOption),
    positionals: (spec.positionals ?? []).map(contractPositional),
    paras: [...(spec.paras ?? [])],
    examples: contractExamples(spec.examples),
    commands: (spec.commands ?? []).map(contractCommand),
  };
}

/** Compact by default (what `--describe` prints), 4-space indent for `--pretty`. */
export function serializeContract(contract: Contract, pretty: boolean): string {
  return `${pretty ? JSON.stringify(contract, null, 4) : JSON.stringify(contract)}\n`;
}

export function findCommand(spec: ToolSpec, name: string): CommandSpec | undefined {
  return spec.commands?.find((command) => command.name === name);
}

export function scopeOf(spec: ToolSpec, command: string): ScopeSpec & { name: string } {
  const found = command ? findCommand(spec, command) : undefined;
  return found ?? spec;
}

export function isContract(value: unknown): value is Contract {
  return isRecord(value) && value['ok'] === true && value['schema_version'] === SCHEMA_VERSION && typeof value['name'] === 'string';
}

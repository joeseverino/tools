// Renderer behind the shell authoring DSL (lib/describe.sh): a shell tool streams
// its declared records on fd 3 and this module renders help, the contract, or the
// dispatch interception from the same typed code every TypeScript tool uses.
//
//   spec-cli.ts usage
//   spec-cli.ts usage-command <command>
//   spec-cli.ts describe [--pretty]
//   spec-cli.ts intercept -- <tool argv...>   exit 0 = handled, 100 = continue
import { readFileSync } from 'node:fs';
import { reportError, die } from './cli.ts';
import type { CommandSpec, Effect, OptionSpec, PositionalSpec, ToolSpec } from './surface.ts';
import { isEffect, renderContract, serializeContract } from './surface.ts';
import { intercept } from './tool.ts';
import { renderUsage, renderUsageFor, terminalWidth } from './usage.ts';

const RECORD = '\u001e';
const FIELD = '\u001f';
export const CONTINUE = 100;

interface Scoped<T> {
  scope: string;
  value: T;
}

interface EffectDecl {
  effect: Effect;
  network: boolean;
  interactive: boolean;
}

function split(record: string): string[] {
  return record.split(FIELD);
}

function at(fields: readonly string[], index: number): string {
  return fields[index] ?? '';
}

function inScope<T>(entries: readonly Scoped<T>[], scope: string): T[] {
  return entries.filter((entry) => entry.scope === scope).map((entry) => entry.value);
}

function option(fields: readonly string[]): Scoped<OptionSpec> {
  const [short, long, metavar, choices, repeat, help] = [at(fields, 1), at(fields, 2), at(fields, 3), at(fields, 4), at(fields, 5), at(fields, 6)];
  const value: OptionSpec = {
    flags: [short, long].filter(Boolean),
    help,
    ...(metavar ? { metavar } : {}),
    ...(choices ? { choices: choices.split(',') } : {}),
    ...(repeat === '1' ? { repeatable: true } : {}),
  };
  return { scope: at(fields, 0), value };
}

function positional(fields: readonly string[]): Scoped<PositionalSpec> {
  const choices = at(fields, 4);
  const value: PositionalSpec = {
    name: at(fields, 1),
    help: at(fields, 5),
    ...(at(fields, 2) === '0' ? { optional: true } : {}),
    ...(at(fields, 3) === '1' ? { variadic: true } : {}),
    ...(choices ? { choices: choices.split(',') } : {}),
  };
  return { scope: at(fields, 0), value };
}

/** Builds a tool spec from the shell DSL's record stream. Exits 2 on a missing or repeated effect. */
export function specFromRecords(stream: string): ToolSpec {
  let name = '';
  let description = '';
  let group = '';
  let order = 0;
  let leafCommands = false;
  const synopsis: string[] = [];
  const paras: Scoped<string>[] = [];
  const commands: { name: string; summary: string }[] = [];
  const options: Scoped<OptionSpec>[] = [];
  const positionals: Scoped<PositionalSpec>[] = [];
  const env: { name: string; help: string }[] = [];
  const examples: Scoped<{ command: string; comment?: string }>[] = [];
  const delegates: Scoped<string>[] = [];
  const effects: Scoped<EffectDecl>[] = [];

  for (const raw of stream.split(RECORD)) {
    if (raw === '') continue;
    const [kind = '', ...rest] = split(raw);
    switch (kind) {
      case 'T': name = at(rest, 0); description = at(rest, 1); break;
      case 'I': group = at(rest, 0); order = Number.parseInt(at(rest, 1), 10) || 0; break;
      case 'L': leafCommands = true; break;
      case 'S': synopsis.push(at(rest, 0)); break;
      case 'P': paras.push({ scope: at(rest, 0), value: at(rest, 1) }); break;
      case 'C': commands.push({ name: at(rest, 0), summary: at(rest, 1) }); break;
      case 'O': options.push(option(rest)); break;
      case 'A': positionals.push(positional(rest)); break;
      case 'E': env.push({ name: at(rest, 0), help: at(rest, 1) }); break;
      case 'X': examples.push({ scope: at(rest, 0), value: { command: at(rest, 1), ...(at(rest, 2) ? { comment: at(rest, 2) } : {}) } }); break;
      case 'D': delegates.push({ scope: at(rest, 0), value: at(rest, 1) }); break;
      case 'F': {
        const effect = at(rest, 1);
        if (!isEffect(effect)) die('contract', `invalid effect '${effect}' in ${name || 'describe_spec'}`, 2);
        effects.push({ scope: at(rest, 0), value: { effect, network: at(rest, 2) === '1', interactive: at(rest, 3) === '1' } });
        break;
      }
      default: break;
    }
  }

  const declared = (scope: string): EffectDecl => {
    const found = inScope(effects, scope);
    const label = `${name}${scope ? ` ${scope}` : ''}`;
    const [only, ...extra] = found;
    if (!only) return die('contract', `'${label}' must declare desc_effect explicitly`, 2);
    if (extra.length) return die('contract', `'${label}' declares desc_effect more than once`, 2);
    return only;
  };
  const tags = (decl: EffectDecl): { effect: Effect; network?: true; interactive?: true } => ({
    effect: decl.effect,
    ...(decl.network ? { network: true as const } : {}),
    ...(decl.interactive ? { interactive: true as const } : {}),
  });
  const scopeParts = (scope: string): Pick<ToolSpec, 'options' | 'positionals' | 'paras' | 'examples'> => ({
    options: inScope(options, scope),
    positionals: inScope(positionals, scope),
    paras: inScope(paras, scope),
    examples: inScope(examples, scope),
  });

  const built: CommandSpec[] = commands.map((command) => {
    const owner = inScope(delegates, command.name)[0];
    return { name: command.name, summary: command.summary, ...tags(declared(command.name)), ...scopeParts(command.name), ...(owner ? { delegates: owner } : {}) };
  });
  const top = tags(declared(''));

  return {
    name,
    description,
    group,
    order,
    ...top,
    ...scopeParts(''),
    ...(synopsis.length ? { synopsis } : {}),
    ...(env.length ? { env } : {}),
    ...(leafCommands ? { leafCommands } : {}),
    commands: built,
  };
}

function main(argv: readonly string[]): number {
  const [mode = '', ...args] = argv;
  const spec = specFromRecords(readFileSync(3, 'utf8'));
  switch (mode) {
    case 'usage':
      process.stdout.write(renderUsage(spec, terminalWidth()));
      return 0;
    case 'usage-command':
      process.stdout.write(renderUsageFor(spec, args[0] ?? '', terminalWidth()));
      return 0;
    case 'describe':
      process.stdout.write(serializeContract(renderContract(spec), args.includes('--pretty')));
      return 0;
    case 'intercept': {
      const separator = args.indexOf('--');
      return intercept(spec, separator < 0 ? [] : args.slice(separator + 1)).handled ? 0 : CONTINUE;
    }
    default:
      return die('usage', `spec-cli: unknown mode '${mode}'`, 2);
  }
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    reportError(error);
  }
}

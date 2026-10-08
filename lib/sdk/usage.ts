// Human help screens rendered from a tool spec. Pure: the caller supplies the
// terminal width.
import { findCommand, longFlag, shortFlag } from './surface.ts';
import type { CommandSpec, OptionSpec, PositionalSpec, ToolSpec } from './surface.ts';

type Scope = Pick<ToolSpec, 'effect' | 'network' | 'interactive' | 'options' | 'positionals' | 'paras' | 'examples'>;

const MIN_WRAP = 20;

export function terminalWidth(): number {
  const columns = Number(process.env['COLUMNS']);
  if (process.env['COLUMNS'] && Number.isFinite(columns)) return columns;
  return process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80;
}

// Words are peeled one separator at a time, so runs of spaces behave the same
// as the shell implementation the goldens were captured from.
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let rest = text;
  let line = '';
  while (rest !== '') {
    const space = rest.indexOf(' ');
    const word = space < 0 ? rest : rest.slice(0, space);
    rest = rest.slice(word.length);
    if (rest.startsWith(' ')) rest = rest.slice(1);
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function row(indent: number, labelWidth: number, label: string, help: string, width: number): string {
  const column = indent + labelWidth + 2;
  const avail = Math.max(width - column, MIN_WRAP);
  const lines = wrapWords(help, avail);
  if (lines.length === 0) lines.push('');
  return lines
    .map((text, index) => (index === 0 ? `${' '.repeat(indent)}${label.padEnd(labelWidth)}  ${text}` : `${' '.repeat(column)}${text}`))
    .map((text) => `${text}\n`)
    .join('');
}

function optionLabel(option: OptionSpec): string {
  const short = shortFlag(option);
  const long = longFlag(option);
  let label = short && long ? `${short}, ${long}` : short || `    ${long}`;
  if (option.choices?.length) label += ` {${option.choices.join(',')}}`;
  else if (option.metavar) label += ` ${option.metavar}`;
  return label;
}

function paraSection(paras: readonly string[] | undefined, width: number): string {
  return (paras ?? [])
    .map((para) => `\n${wrapWords(para, Math.max(width, MIN_WRAP)).map((line) => `${line}\n`).join('')}`)
    .join('');
}

function effectLine(scope: Pick<Scope, 'effect' | 'network' | 'interactive'>): string {
  if (scope.effect === 'read' && !scope.network && !scope.interactive) return '';
  const tags = [scope.effect, ...(scope.network ? ['network'] : []), ...(scope.interactive ? ['interactive'] : [])];
  return `\nEffect: ${tags.join(' · ')}\n`;
}

function positionalLabel(positional: PositionalSpec): string {
  return positional.choices?.length ? `${positional.name} {${positional.choices.join(',')}}` : positional.name;
}

function positionalSection(positionals: readonly PositionalSpec[] | undefined, width: number): string {
  if (!positionals?.length) return '';
  const labelWidth = Math.max(...positionals.map((positional) => positionalLabel(positional).length));
  const rows = positionals.map((positional) => row(2, labelWidth, positionalLabel(positional), positional.help, width));
  return `\nArguments:\n${rows.join('')}`;
}

function optionSection(options: readonly OptionSpec[] | undefined, width: number): string {
  const labels = (options ?? []).map((option) => ({ label: optionLabel(option), help: option.help }));
  const labelWidth = Math.max(10, ...labels.map((entry) => entry.label.length));
  const rows = [...labels, { label: '-h, --help', help: 'Show this help' }].map((entry) => row(2, labelWidth, entry.label, entry.help, width));
  return `\nOptions:\n${rows.join('')}`;
}

function exampleSection(spec: Pick<Scope, 'examples'>): string {
  const examples = spec.examples ?? [];
  if (!examples.length) return '';
  const commandWidth = Math.max(...examples.map((example) => example.command.length));
  const lines = examples.map((example) =>
    example.comment ? `  ${example.command.padEnd(commandWidth)}  # ${example.comment}\n` : `  ${example.command}\n`,
  );
  return `\nExamples:\n${lines.join('')}`;
}

function hasArgs(command: CommandSpec): boolean {
  return Boolean(command.positionals?.length || command.options?.length);
}

export function renderUsage(spec: ToolSpec, width: number): string {
  const synopsis = spec.synopsis?.length ? spec.synopsis : [`${spec.name} [options]`];
  let out = synopsis.map((line, index) => `${index === 0 ? 'Usage: ' : '       '}${line}\n`).join('');

  out += spec.paras?.length ? paraSection(spec.paras, width) : spec.description ? `\n${spec.description}\n` : '';
  out += effectLine(spec);

  const commands = spec.commands ?? [];
  if (commands.length) {
    const nameWidth = Math.max(...commands.map((command) => command.name.length));
    out += `\nCommands:\n${commands.map((command) => row(2, nameWidth, command.name, command.summary, width)).join('')}`;
  }

  out += positionalSection(spec.positionals, width);
  out += optionSection(spec.options, width);

  if (commands.some(hasArgs)) out += `\nRun '${spec.name} <command> -h' for a command's options and arguments.\n`;

  if (spec.env?.length) {
    const nameWidth = Math.max(...spec.env.map((entry) => entry.name.length));
    out += `\nEnvironment:\n${spec.env.map((entry) => row(2, nameWidth, entry.name, entry.help, width)).join('')}`;
  }

  return out + exampleSection(spec);
}

function positionalSynopsis(positionals: readonly PositionalSpec[] | undefined): string {
  return (positionals ?? [])
    .map((positional) => {
      let token = positional.choices?.length ? `{${positional.choices.join('|')}}` : `<${positional.name}>`;
      if (positional.optional) token = `[${token}]`;
      return positional.variadic ? `${token}...` : token;
    })
    .join(' ');
}

/** Focused help for one command; an unknown command falls back to the full screen. */
export function renderUsageFor(spec: ToolSpec, name: string, width: number): string {
  const command = findCommand(spec, name);
  if (!command) return renderUsage(spec, width);
  const positionals = positionalSynopsis(command.positionals);
  let out = `Usage: ${spec.name} ${name} [options]${positionals ? ` ${positionals}` : ''}\n`;
  if (command.summary) out += `\n${command.summary}\n`;
  out += paraSection(command.paras, width);
  out += effectLine(command);
  if (command.delegates) out += `\nFlags are owned elsewhere: ${command.delegates}\n`;
  out += positionalSection(command.positionals, width);
  out += optionSection(command.options, width);
  return out + exampleSection(command);
}

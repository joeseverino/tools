import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { die } from '../sdk/cli.ts';
import { blank, msg } from '../sdk/output.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: 'remember',
  description: 'Write a Claude memory file + MEMORY.md index entry in one shot.',
  group: 'Authoring',
  order: 160,
  effect: 'local_write',
  synopsis: [
    'remember <type> <slug> "<title>" [options]   < body',
    'remember <type> <slug> "<title>" -b "body" [options]',
    'remember --list',
    'remember --forget <slug>',
  ],
  paras: [
    'Compress the two-step "write file + edit MEMORY.md" loop into one command.',
    'Body content is read from stdin unless --body is given. Frontmatter is generated from the args.',
  ],
  positionals: [
    { name: 'type', help: 'user | feedback | project | reference' },
    { name: 'slug', help: "kebab- or snake-case identifier (becomes 'name:' in frontmatter; underscored in filename)" },
    { name: 'title', help: 'text shown as the link in MEMORY.md' },
  ],
  options: [
    { flags: ['-d', '--description'], metavar: 'STR', help: 'Frontmatter description (default: title)' },
    { flags: ['-k', '--hook'], metavar: 'STR', help: 'MEMORY.md one-liner hook (default: title)' },
    { flags: ['-b', '--body'], metavar: 'STR', help: 'Body text in lieu of stdin' },
    { flags: ['-f', '--body-file'], metavar: 'FILE', help: 'Body text from file' },
    { flags: ['-F', '--force'], help: 'Overwrite an existing memory (update in place)' },
    {
      flags: ['--dir'],
      metavar: 'PATH',
      help: 'Memory dir. Default: CLAUDE_MEMORY_DIR, else CLAUDE_PROJECT_DIR, else $PWD (for a git worktree, its main checkout) — encoded to ~/.claude/projects/<enc>/memory. No flag needed inside a Claude project.',
    },
    { flags: ['--list'], help: 'Show the MEMORY.md index' },
    { flags: ['--forget'], metavar: 'SLUG', help: 'Delete the memory and its index entry' },
  ],
  examples: [
    { command: 'echo "rule body here" | remember feedback use-rg-and-fd "Use rg and fd"' },
    { command: 'remember feedback use-rg-and-fd "Use rg and fd" -F < updated-body', comment: 'update' },
    { command: 'remember --list' },
    { command: 'remember --forget use-rg-and-fd' },
  ],
};

const TYPES = ['user', 'feedback', 'project', 'reference'] as const;

function isType(value: string): value is (typeof TYPES)[number] {
  return (TYPES as readonly string[]).includes(value);
}

/** Claude's memory dir for a project path: every /, . and space folds to '-'. */
export function encodeClaudePath(projectPath: string, home: string): string {
  return `${home}/.claude/projects/${projectPath.replace(/[/. ]/g, '-')}/memory`;
}

/** The checkout a path belongs to: a git worktree's main checkout, as Claude
 * Code files a worktree session's memory under the project it came from. */
export function projectRoot(path: string): string {
  const found = spawnSync('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  const common = found.status === 0 ? found.stdout.trim() : '';
  return common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : path;
}

/** Strips a leading type prefix (applied in sequence) and underscores the rest. */
export function normalizeSlug(slug: string): string {
  let out = slug;
  for (const prefix of ['user_', 'feedback_', 'project_', 'reference_']) if (out.startsWith(prefix)) out = out.slice(prefix.length);
  return out.replace(/-/g, '_');
}

export function memoryFileText(kebabName: string, type: string, description: string, body: string): string {
  const escaped = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `---\nname: ${kebabName}\ndescription: "${escaped}"\nmetadata:\n  type: ${type}\n---\n\n${body}\n`;
}

function lines(text: string): string[] {
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** The index without any line that links to filename; empty string when nothing is left. */
export function dropIndexLines(index: string, filename: string): string {
  const kept = lines(index).filter((line) => !line.includes(`(${filename})`));
  return kept.length ? `${kept.join('\n')}\n` : '';
}

/** Drops any existing line for filename, then appends the new entry. */
export function upsertIndex(index: string, filename: string, entry: string): string {
  const existing = index === '' ? '' : lines(index).filter((line) => !line.includes(`(${filename})`)).join('\n').replace(/\n+$/, '');
  return existing ? `${existing}\n${entry}\n` : `${entry}\n`;
}

function needValue(args: readonly string[], index: number, what: string): string {
  const value = args[index + 1];
  if (value === undefined || value === '') die('error', `remember: ${args[index] ?? ''} needs ${what}`);
  return value;
}

type Mode = 'write' | 'list' | 'forget';

const run: Handler = (args, rt) => {
  let mode: Mode = 'write';
  let targetDir = '';
  let description = '';
  let hook = '';
  let body = '';
  let bodyFile = '';
  let forgetSlug = '';
  let force = false;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--') break;
    switch (arg) {
      case '--list': mode = 'list'; break;
      case '--forget': mode = 'forget'; forgetSlug = needValue(args, index, 'a slug'); index += 1; break;
      case '-d': case '--description': description = needValue(args, index, 'a value'); index += 1; break;
      case '-k': case '--hook': hook = needValue(args, index, 'a value'); index += 1; break;
      case '-b': case '--body': body = needValue(args, index, 'a value'); index += 1; break;
      case '-f': case '--body-file': bodyFile = needValue(args, index, 'a path'); index += 1; break;
      case '-F': case '--force': force = true; break;
      case '--dir': targetDir = needValue(args, index, 'a path'); index += 1; break;
      default:
        if (arg.startsWith('-')) rt.dieUnknown('option', arg);
        positional.push(arg);
    }
  }

  if (targetDir === '') {
    const home = process.env['HOME'] ?? '';
    if (process.env['CLAUDE_MEMORY_DIR']) targetDir = process.env['CLAUDE_MEMORY_DIR'];
    else targetDir = encodeClaudePath(projectRoot(process.env['CLAUDE_PROJECT_DIR'] || process.cwd()), home);
  }

  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    if (mode !== 'write') die('error', `memory dir not found: ${targetDir}`);
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch {
      die('error', `cannot create memory dir: ${targetDir}`);
    }
  }
  const indexPath = path.join(targetDir, 'MEMORY.md');

  if (mode === 'list') {
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) die('error', `no MEMORY.md at ${indexPath}`);
    blank();
    msg('green', 'index', indexPath);
    blank();
    process.stdout.write(readFileSync(indexPath));
    blank();
    return 0;
  }

  if (mode === 'forget') {
    const base = normalizeSlug(forgetSlug);
    const suffix = `_${base}.md`;
    const matches = readdirSync(targetDir)
      .filter((name) => name.endsWith(suffix) && !name.startsWith('.'))
      .sort();
    if (matches.length === 0) die('error', `no memory matched: ${forgetSlug} (looked for *_${base}.md)`);
    if (matches.length > 1) die('error', `ambiguous slug ${forgetSlug} matched: ${matches.join(' ')}`);
    const target = matches[0] ?? '';
    unlinkSync(path.join(targetDir, target));
    if (existsSync(indexPath) && statSync(indexPath).isFile()) writeFileSync(indexPath, dropIndexLines(readFileSync(indexPath, 'utf8'), target));
    blank();
    msg('green', 'forgot', target);
    blank();
    return 0;
  }

  if (positional.length !== 3) die('usage', `expected: remember <type> <slug> "<title>" (got ${positional.length})`, 2);
  const [type = '', slug = '', title = ''] = positional;
  if (!isType(type)) die('usage', 'type must be one of: user, feedback, project, reference', 2);
  if (slug === '') die('usage', 'slug cannot be empty', 2);
  if (title === '') die('usage', 'title cannot be empty', 2);

  if (body === '') {
    if (bodyFile !== '') {
      if (!existsSync(bodyFile) || !statSync(bodyFile).isFile()) die('error', `body file not found: ${bodyFile}`);
      body = readFileSync(bodyFile, 'utf8').replace(/\n+$/, '');
    } else if (!process.stdin.isTTY) body = readFileSync(0, 'utf8').replace(/\n+$/, '');
    else die('usage', 'body required (pipe stdin, use --body, or --body-file)', 2);
  }

  const baseSlug = normalizeSlug(slug);
  const filename = `${type}_${baseSlug}.md`;
  const filepath = path.join(targetDir, filename);
  if (existsSync(filepath) && !force) die('error', `memory file exists: ${filename} (use --force to update, or --forget)`);
  const verb = existsSync(filepath) ? 'updated' : 'remembered';

  writeFileSync(filepath, memoryFileText(`${type}-${baseSlug.replace(/_/g, '-')}`, type, description || title, body));
  const entry = `- [${title}](${filename}) — ${hook || title}`;
  const current = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  writeFileSync(indexPath, upsertIndex(current, filename, entry));

  blank();
  msg('green', verb, filename);
  msg('green', 'indexed', indexPath);
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, run };

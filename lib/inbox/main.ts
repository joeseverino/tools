import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { die, usageError } from '../sdk/cli.ts';
import { loadShellConfig } from '../sdk/config.ts';
import { blank, msg } from '../sdk/output.ts';
import { runInherit } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: 'inbox',
  description: 'Quick-capture a note into the vault inbox.',
  group: 'Vault',
  order: 50,
  effect: 'vault_write',
  synopsis: ['inbox [options] [text...]', 'cmd | inbox [options]'],
  paras: [
    'Capture a quick note into your vault inbox folder. The filename is "YYYY-MM-DD HHMMSS <first words>.md" and the body is the captured text, prefixed with doc_id and created frontmatter.',
  ],
  options: [
    {
      flags: ['-e', '--edit'],
      help: 'Open the captured note in $EDITOR after writing. With no text/stdin, creates an empty note, opens the editor, then renames the file from its first non-empty content line on save.',
    },
  ],
  positionals: [{ name: 'text', optional: true, variadic: true, help: 'Note text (joined). Omitted when piping stdin.' }],
  env: [
    { name: 'NOTES_HOME', help: 'Read from ~/.zshrc; resolves VAULT' },
    { name: 'VAULT', help: 'Per-invocation override for the vault path' },
    { name: 'INBOX_DIR', help: 'Per-invocation override for the inbox folder' },
    { name: 'EDITOR', help: 'Used by -e (defaults to nano)' },
  ],
  examples: [
    { command: 'inbox "remember to update the homelab certs"' },
    { command: 'pbpaste | inbox' },
    { command: 'echo "lookup later" | inbox' },
    { command: 'inbox -e', comment: 'blank note, opens editor' },
    { command: 'inbox -e "draft: post-mortem template"', comment: 'seed + open editor' },
  ],
};

const SLUG_LIMIT = 50;

/** One line of text made safe for a filename: path-hostile characters become '-', capped at 50. */
export function slugify(text: string): string {
  const firstLine = (text.split('\n')[0] ?? '').replace(/\r/g, '');
  const safe = firstLine.replace(/[/\\:?*<>|"]/g, '-').trim();
  return [...safe].slice(0, SLUG_LIMIT).join('').trimEnd();
}

/** The first non-empty line outside the frontmatter block, or ''. */
export function firstContentLine(markdown: string): string {
  let inFrontmatter = false;
  for (const line of markdown.split('\n')) {
    if (line === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    if (line.trim() !== '') return line;
  }
  return '';
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function timestamps(now: Date): { timestamp: string; docId: string; created: string } {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const compact = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return {
    timestamp: `${date} ${clock}`,
    docId: `${compact}-${clock}`,
    created: `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
}

export function noteBody(docId: string, created: string, text: string): string {
  return `---\ndoc_id: inbox-${docId}\ncreated: ${created}\n---\n\n${text ? `${text}\n` : ''}`;
}

const run: Handler = (args, rt) => {
  let edit = false;
  let index = 0;
  for (; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-e' || arg === '--edit') edit = true;
    else if (arg === '--') {
      index += 1;
      break;
    } else if (arg.startsWith('-')) rt.dieUnknown('option', arg);
    else break;
  }
  const rest = args.slice(index);

  const config = loadShellConfig('vault', { scalars: ['INBOX_DIR'] });
  const inboxDir = config.scalars['INBOX_DIR'] ?? '';

  let text: string;
  if (rest.length > 0) text = rest.join(' ');
  else if (!process.stdin.isTTY) text = readFileSync(0, 'utf8').replace(/\n+$/, '');
  else if (edit) text = '';
  else return usageError('no text provided (give args or pipe input; try -h)');

  text = text.trim();
  if (text === '' && !edit) return usageError('empty input');

  if (!existsSync(inboxDir) || !statSync(inboxDir).isDirectory()) die('error', `inbox directory not found: ${inboxDir}`);

  const { timestamp, docId, created } = timestamps(new Date());
  let filename = `${timestamp} ${slugify(text) || 'note'}.md`;
  let filepath = path.join(inboxDir, filename);
  writeFileSync(filepath, noteBody(docId, created, text));

  if (edit) {
    const editor = process.env['EDITOR'] || 'nano';
    const status = runInherit(editor, [filepath]);
    if (status !== 0) return status;

    if (text === '') {
      const newSlug = slugify(firstContentLine(readFileSync(filepath, 'utf8')));
      if (newSlug !== '' && newSlug !== 'note') {
        const newFilename = `${timestamp} ${newSlug}.md`;
        const newFilepath = path.join(inboxDir, newFilename);
        if (newFilepath !== filepath) {
          renameSync(filepath, newFilepath);
          filename = newFilename;
          filepath = newFilepath;
        }
      }
    }
  }

  blank();
  msg('green', 'captured', filename);
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, run };

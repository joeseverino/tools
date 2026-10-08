import path from 'node:path';
import { loadShellConfig } from '../sdk/config.ts';
import { toolsHome } from '../sdk/paths.ts';
import { runInherit } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: 'marks',
  description: 'Safari Reading List & bookmarks, mirrored into the Life vault.',
  group: 'Vault',
  order: 65,
  leafCommands: true,
  effect: 'read',
  synopsis: ['marks [status] | marks list <collection> | marks sync [--dry-run]'],
  paras: [
    'Safari\'s own iCloud-synced Bookmarks.plist is the single source of truth — marks never writes to it (deleting and organizing stay in Safari, which keeps iCloud sync honest). \'marks sync\' derives two surfaces in the Life vault: current notes (Reading List.md, Bookmarks.md — exact regenerated mirrors of what is in Safari right now) and append-only Archive ledgers that record every URL ever seen, deduped, under dated headings. Clean up in Safari, run \'marks sync\', and the current notes shrink while the archive never forgets.',
    'Re-running sync with no Safari changes is a byte-identical no-op; sync metadata (last run, counts) lives in the state file, not in the notes. Bare \'marks\' is \'marks status\'.',
  ],
  env: [
    { name: 'LIFE_HOME', help: 'Life vault root (default ~/Documents/Life)' },
    { name: 'MARKS_DIR', help: 'Derived-notes folder (default $LIFE_HOME/Bookmarks)' },
    { name: 'MARKS_PLIST', help: 'Safari plist to read (default ~/Library/Safari/Bookmarks.plist)' },
    { name: 'MARKS_STATE', help: 'Sync-state JSON (default $XDG_STATE_HOME/severino-tools/marks-sync.json)' },
  ],
  examples: [
    { command: 'marks', comment: 'counts in Safari vs archived, and last sync' },
    { command: 'marks sync', comment: 'refresh current notes, append new URLs to the ledgers' },
    { command: 'marks list reading-list', comment: 'what\'s in Safari\'s Reading List right now' },
    { command: 'marks export | jq \'.favorites\'', comment: 'the whole model as one JSON document' },
  ],
  commands: [
    { name: 'status', summary: 'Counts in Safari vs archived in the vault, and the last sync', effect: 'read', options: [{ flags: ['--json'], help: 'Machine-readable output' }] },
    {
      name: 'list',
      summary: 'One collection as it is in Safari right now',
      effect: 'read',
      positionals: [{ name: 'collection', choices: ['reading-list', 'bookmarks', 'favorites'], help: 'Which Safari collection to list' }],
      options: [{ flags: ['--json'], help: 'Machine-readable output' }],
    },
    {
      name: 'sync',
      summary: 'Regenerate the current notes and append new URLs to the Archive ledgers',
      effect: 'vault_write',
      options: [
        { flags: ['--dry-run'], help: 'Report what would change without writing' },
        { flags: ['--json'], help: 'Machine-readable summary' },
      ],
    },
    { name: 'export', summary: 'The canonical model (reading-list, bookmarks, favorites) as one JSON document', effect: 'read' },
  ],
};

const COMMANDS = ['status', 'list', 'sync', 'export'];

const run: Handler = (args, rt) => {
  const [first, ...rest] = args;
  const command = first ?? 'status';
  if (!COMMANDS.includes(command)) return rt.dieUnknown('command', command);
  const { scalars } = loadShellConfig('marks', { scalars: ['MARKS_PLIST', 'MARKS_DIR', 'MARKS_STATE'] });
  return runInherit('python3', [
    path.join(toolsHome, 'lib', 'marks', 'marks.py'),
    '--plist', scalars['MARKS_PLIST'] ?? '',
    '--dir', scalars['MARKS_DIR'] ?? '',
    '--state', scalars['MARKS_STATE'] ?? '',
    command,
    ...rest,
  ]);
};

export const tool: ToolDefinition = { spec, run };

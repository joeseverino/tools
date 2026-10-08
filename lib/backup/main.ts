import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { die } from '../sdk/cli.ts';
import { loadShellConfig } from '../sdk/config.ts';
import { footer, header, msg, palette } from '../sdk/output.ts';
import { run, runInherit } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: 'backup',
  description: 'Mirror the items in config/backup.sh into $BACKUPS_HOME.',
  group: 'Backup',
  order: 70,
  effect: 'local_write',
  synopsis: ['backup [options]'],
  paras: [
    'Mirror each tracked file into $BACKUPS_HOME using the mapping in config/backup.sh. Uses rsync, so permissions, xattrs, and timestamps are preserved and unchanged files are skipped at the byte level.',
    'If $BACKUPS_HOME is a git repo, an auto-commit is made after the copy so each backup run leaves a point-in-time entry in the local history.',
    'Add or remove items by editing tools/config/backup.sh.',
  ],
  options: [
    { flags: ['-n', '--dry-run'], help: 'Show what would be copied; do not write' },
    { flags: ['--no-commit'], help: 'Skip the auto-commit step' },
  ],
  env: [{ name: 'BACKUPS_HOME', help: 'Read from ~/.zshrc; backup destination root' }],
};

export interface BackupEntry {
  source: string;
  destination: string;
}

/** Splits "<source><TAB><destination>"; null when the tab or destination is missing. */
export function parseEntry(item: string): BackupEntry | null {
  const tab = item.indexOf('\t');
  if (tab < 0) return null;
  const destination = item.slice(tab + 1);
  return destination === '' ? null : { source: item.slice(0, tab), destination };
}

/** Directories mirror contents with --delete; files copy to the exact destination path. */
export function rsyncPlan(source: string, destination: string, isDirectory: boolean): { args: string[]; destDir: string } {
  return isDirectory
    ? { args: ['-a', '--delete', `${source}/`, `${destination}/`], destDir: destination }
    : { args: ['-a', source, destination], destDir: path.dirname(destination) };
}

function timestamp(now: Date): string {
  const p = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

function autoCommit(home: string): number {
  const add = runInherit('git', ['add', '-A'], { cwd: home });
  if (add !== 0) return add;
  if (run('git', ['diff', '--cached', '--quiet'], { cwd: home }).ok) {
    msg('dim', 'git', 'no changes to commit');
  } else if (runInherit('git', ['commit', '-m', `backup: ${timestamp(new Date())}`, '--quiet'], { cwd: home }) === 0) {
    msg('green', 'committed', run('git', ['rev-parse', '--short', 'HEAD'], { cwd: home }).stdout.trim());
  } else {
    msg('red', 'git', 'commit failed');
  }
  return 0;
}

const handler: Handler = (args, rt) => {
  const config = loadShellConfig('backup', { scalars: ['BACKUPS_HOME'], arrays: ['BACKUP_ITEMS'] });
  const backupsHome = config.scalars['BACKUPS_HOME'] ?? process.env['BACKUPS_HOME'] ?? '';
  const items = config.arrays['BACKUP_ITEMS'] ?? [];

  let dry = false;
  let noCommit = false;
  for (const arg of args) {
    if (arg === '--') break;
    if (arg === '-n' || arg === '--dry-run') dry = true;
    else if (arg === '--no-commit') noCommit = true;
    else if (arg.startsWith('-')) rt.dieUnknown('option', arg);
    else die('usage', `unexpected argument: ${arg} (try -h)`, 2);
  }

  if (items.length < 1) die('error', 'no items defined in config/backup.sh');
  if (!run('rsync', ['--version']).ok) die('error', 'rsync not installed');

  const p = palette();
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  header('backing up', items.length);

  for (const item of items) {
    const entry = parseEntry(item);
    if (!entry) {
      msg('red', 'failed', `malformed entry: ${item} ${p.DIM}(missing tab)${p.RESET}`);
      failed += 1;
      continue;
    }
    const { source, destination: relative } = entry;
    const destination = `${backupsHome}/${relative}`;

    if (!existsSync(source)) {
      msg('yellow', 'skipped', `${source} ${p.DIM}(not found)${p.RESET}`);
      skipped += 1;
      continue;
    }
    if (dry) {
      msg('yellow', 'would copy', `${source} ${p.DIM}→${p.RESET} ${relative}`);
      ok += 1;
      continue;
    }

    const plan = rsyncPlan(source, destination, statSync(source).isDirectory());
    mkdirSync(plan.destDir, { recursive: true });
    const result = run('rsync', plan.args);
    if (result.ok) {
      msg('green', 'backed up', `${source} ${p.DIM}→${p.RESET} ${relative}`);
      ok += 1;
    } else {
      const first = `${result.stderr}${result.stdout}`.split('\n')[0] ?? '';
      msg('red', 'failed', `${source} ${p.DIM}(${first})${p.RESET}`);
      failed += 1;
    }
  }

  if (!dry && !noCommit && existsSync(path.join(backupsHome, '.git')) && statSync(path.join(backupsHome, '.git')).isDirectory()) {
    const status = autoCommit(backupsHome);
    if (status !== 0) return status;
  }

  footer('backed up', ok, skipped, failed);
  return failed === 0 ? 0 : 1;
};

export const tool: ToolDefinition = { spec, run: handler };

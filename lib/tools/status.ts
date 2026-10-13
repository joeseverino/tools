import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { blank, msg, palette } from '../sdk/output.ts';
import { run } from '../sdk/process.ts';
import { inboxCount, vaultRemote, vaultTree } from '../vault/state.ts';

function git(dir: string, args: readonly string[]): { ok: boolean; out: string } {
  const result = run('git', ['-C', dir, ...args]);
  return { ok: result.ok, out: result.stdout };
}

function isDir(candidate: string): boolean {
  return candidate !== '' && existsSync(candidate) && statSync(candidate).isDirectory();
}

export interface StatusFacts {
  vault: string;
  inbox: string;
  backupsHome: string;
}

export function runStatus(facts: StatusFacts, json: boolean): number {
  const { vault, inbox, backupsHome } = facts;
  const vaultOk = isDir(vault) && isDir(path.join(vault, '.git'));
  const tree = vaultOk ? vaultTree(vault) : '';
  const remote = vaultOk ? vaultRemote(vault) : '';
  const inboxOk = isDir(inbox);
  const pending = inboxOk ? inboxCount(inbox) : 0;
  const backupOk = backupsHome !== '';
  const backupRepo = backupOk && isDir(path.join(backupsHome, '.git'));
  const lastMessage = backupRepo ? git(backupsHome, ['log', '-1', '--pretty=%s']).out.replace(/\n+$/, '') : '';
  const lastWhen = backupRepo ? git(backupsHome, ['log', '-1', '--pretty=%cr']).out.replace(/\n+$/, '') : '';

  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      vault: { ok: vaultOk, tree, remote, path: vault },
      inbox: { ok: inboxOk, pending },
      backup: { ok: backupOk && backupRepo, git_repo: backupRepo, last_commit: lastMessage, last_commit_when: lastWhen },
    })}\n`);
    return 0;
  }

  const p = palette();
  blank();
  if (vaultOk) {
    const treeColor = tree === 'clean' ? p.GREEN : p.YELLOW;
    const remoteColor = remote === 'in sync' ? p.GREEN : p.YELLOW;
    msg('reset', 'vault', `${treeColor}${tree}${p.RESET}, ${remoteColor}${remote}${p.RESET} ${p.DIM}(${vault})${p.RESET}`);
  } else msg('red', 'vault', 'not a git repo or VAULT not set');

  if (inboxOk) {
    if (pending > 0) msg('yellow', 'inbox', `${pending} pending note${pending === 1 ? '' : 's'}`);
    else msg('green', 'inbox', 'empty');
  } else msg('red', 'inbox', 'INBOX_DIR not set or missing');

  if (backupRepo) {
    if (lastMessage) msg('green', 'backup', `last commit ${p.DIM}${lastWhen}${p.RESET} — ${lastMessage}`);
    else msg('yellow', 'backup', 'no commits yet');
  } else if (backupOk) msg('yellow', 'backup', `${backupsHome} ${p.DIM}(not a git repo)${p.RESET}`);
  else msg('red', 'backup', 'BACKUPS_HOME not set');
  blank();
  return 0;
}

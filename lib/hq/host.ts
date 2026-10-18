// hq commands that act on the HQ host over ssh or on the local HQ checkout.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { die, usageError } from '../sdk/cli.ts';
import { isRecord, parseJson } from '../sdk/guards.ts';
import { msg } from '../sdk/output.ts';
import { run, runInherit } from '../sdk/process.ts';
import type { Handler } from '../sdk/tool.ts';
import { commit, git } from '../git/index.ts';
import { jqLength, loadHqEnv, requireAdmin } from './env.ts';
import { which } from '../sdk/which.ts';

const MAX_BUFFER = 256 * 1024 * 1024;

function lastLine(text: string): string {
  const lines = text.replace(/\n+$/, '').split('\n');
  return lines[lines.length - 1] ?? '';
}

// HQ's host layout (controller/host/layout.go): systemd runs the web container
// under one unit, and the renderer writes its environment to a root-only tmpfs.
export const WEB_UNIT = 'severino-hq-web.service';
export const SECRETS_UNIT = 'severino-hq-secrets.service';
export const RENDERED_ENV = '/run/severino-hq-secrets/web/severino_hq_env';

/** A manage.py command in the running web container, as HQ's install guide runs one. */
export function containerManage(container: string, command: string, mode: 'stdin' | 'tty'): string {
  return `sudo docker exec ${mode === 'tty' ? '-it' : '-i'} ${container} python manage.py ${command}`;
}

/** The web unit's journal, where the container's output goes. */
export function journal(lines: string, follow: boolean): string {
  return `sudo journalctl -u ${WEB_UNIT} --no-pager ${follow ? '-f' : `-n ${lines}`}`;
}

export const lifeSync: Handler = () => {
  const env = loadHqEnv();
  requireAdmin(env);
  if (!which('life')) die('error', "the 'life' CLI is required to emit the snapshot");

  msg('dim', 'emitting', 'life snapshot');
  const emitted = run('life', ['snapshot', '--json'], { maxBuffer: MAX_BUFFER });
  if (!emitted.ok) die('error', 'life snapshot failed; nothing was sent');
  const snapshot = emitted.stdout.replace(/\n+$/, '');

  const parsed = parseJson(snapshot);
  const data = isRecord(parsed) ? parsed['data'] : undefined;
  if (!isRecord(parsed) || !('schema_version' in parsed) || !('content_hash' in parsed) || !isRecord(data)) {
    die('error', 'life snapshot is not a valid envelope; nothing was sent');
  }
  const total = Object.values(data).reduce<number>((sum, value) => sum + jqLength(value), 0);
  if (total <= 0) die('error', 'life snapshot contains no records; refusing to prune prod');

  msg('dim', 'sending', Object.entries(data).map(([key, value]) => `${jqLength(value)} ${key}`).join(' · '));

  // -i without -t: stdin is the document, and a TTY would swallow it.
  const sent = spawnSync('ssh', [env.sshHost, containerManage(env.container, 'ingest_life_snapshot', 'stdin')], {
    input: snapshot,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if ((sent.status ?? 1) !== 0) die('error', `ingest failed on ${env.sshHost}`);
  msg('green', 'synced', 'life → severino-hq');
  return 0;
};

const ENV_KEY = /^[A-Z][A-Z0-9_]+$/;

/** Variable names from an `op item get --format json` document. */
export function itemKeys(itemJson: string): string[] {
  const parsed = parseJson(itemJson);
  const fields = isRecord(parsed) ? parsed['fields'] : undefined;
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field) => (isRecord(field) && typeof field['label'] === 'string' ? field['label'] : ''))
    .filter((label) => ENV_KEY.test(label))
    .sort();
}

/** Variable names from rendered `KEY=value` text (the part before the first `=`). */
export function renderedKeys(rendered: string): string[] {
  const keys = rendered.replace(/\n+$/, '').split('\n').map((line) => line.split('=')[0] ?? '').sort().join('\n').replace(/\n+$/, '');
  return keys === '' ? [] : keys.split('\n');
}

export function envDrift(itemKeyList: readonly string[], renderedKeyList: readonly string[]): string[] {
  const item = new Set(itemKeyList);
  const rendered = new Set(renderedKeyList);
  return [
    ...[...item].filter((key) => !rendered.has(key)).map((key) => `item-only (not yet rendered): ${key}`),
    ...[...rendered].filter((key) => !item.has(key)).map((key) => `rendered-only (gone from item): ${key}`),
  ].sort();
}

export const envDiff: Handler = (args, rt) => {
  const env = loadHqEnv();
  requireAdmin(env);
  if (args[0] !== undefined && args[0] !== '') return rt.dieUnknown('flag', args[0], 'env-diff');
  if (!which('op')) die('error', '1Password CLI (op) is required for env-diff');
  const renderedPath = RENDERED_ENV;

  const item = run('op', ['item', 'get', env.envItem, '--vault', env.envVault, '--format', 'json']);
  if (!item.ok) die('error', `cannot read "${env.envItem}" from 1Password: ${lastLine(`${item.stdout}${item.stderr}`)}`);
  const itemKeyList = itemKeys(item.stdout);
  if (itemKeyList.length === 0) die('error', `"${env.envItem}" yielded no environment keys — wrong item?`);

  const rendered = run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', env.sshHost, `sudo cat '${renderedPath}'`]);
  if (!rendered.ok) die('error', `cannot read ${env.sshHost}:${renderedPath}: ${lastLine(`${rendered.stdout}${rendered.stderr}`)}`);
  const renderedKeyList = renderedKeys(rendered.stdout);
  if (renderedKeyList.length === 0) die('error', `${renderedPath} is empty on ${env.sshHost} — has the env been rendered?`);

  const drift = envDrift(itemKeyList, renderedKeyList);
  if (drift.length === 0) {
    msg('green', 'in sync', `item keys match the rendered env on ${env.sshHost} (values refresh hourly)`);
    return 0;
  }
  for (const line of drift) msg('yellow', 'drift', line);
  msg('dim', 'next', 'hq env-apply renders the item to prod now');
  return 1;
};

export const envApply: Handler = (args, rt) => {
  const env = loadHqEnv();
  requireAdmin(env);
  if (args[0] !== undefined && args[0] !== '' && args[0] !== '--yes') return rt.dieUnknown('flag', args[0], 'env-apply');
  msg('dim', 'applying', `${SECRETS_UNIT} on ${env.sshHost}`);
  const applied = runInherit('ssh', [env.sshHost, `sudo systemctl start ${SECRETS_UNIT} && sudo systemctl status ${SECRETS_UNIT} --no-pager | tail -3`]);
  if (applied !== 0) return applied;
  const inspected = spawnSync('ssh', [env.sshHost, `sudo docker inspect --format '{{.State.Health.Status}}' ${env.container}`], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'ignore'],
  });
  const health = (inspected.stdout ?? '').replace(/\n+$/, '');
  if (health !== 'healthy') die('error', `container is '${health || 'unknown'}' after env apply — check \`hq logs\``);
  msg('green', 'applied', 'prod env is current; container healthy');
  return 0;
};

const APP_DIRS = ['assets', 'content', 'core', 'docs', 'docs_index', 'expenses', 'projects', 'receipts', 'reports', 'static', 'templates'];

/** Exit status BSD xargs reports for a `python3 -m py_compile` batch: 1 on any failure, 126/127 kept. */
export function xargsStatus(status: number): number {
  if (status === 0) return 0;
  return status === 126 || status === 127 ? status : 1;
}

export const ship: Handler = (args, rt) => {
  const env = loadHqEnv();
  let message = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-m' || arg === '--message') {
      const next = args[index + 1];
      if (next === undefined || next === '') die('error', '--message needs text');
      message = next;
      index += 1;
    } else if (arg.startsWith('--message=')) message = arg.slice('--message='.length);
    else return rt.dieUnknown('flag', arg, 'ship');
  }

  if (!message) die('usage', 'missing -m "commit message"');
  if (!isDirectory(path.join(env.localPath, '.git'))) die('error', `HQ_LOCAL_PATH is not a git repo: ${env.localPath}`);

  msg('dim', 'checking', `${env.localPath} (py_compile)`);
  const files = git(env.localPath, ['ls-files', '*.py']).stdout.split('\n').filter(Boolean);
  if (files.length > 0) {
    const compiled = spawnSync('python3', ['-m', 'py_compile', ...files], { cwd: env.localPath, stdio: 'inherit' });
    const status = xargsStatus(compiled.status ?? 127);
    if (status !== 0) return status;
  }

  if (git(env.localPath, ['status', '--porcelain']).stdout.trim() === '') {
    msg('green', 'clean', 'no local HQ changes to commit');
    return 0;
  }

  msg('dim', 'staging', 'tracked changes + known HQ app files');
  const rc = commitAndPush(env.localPath, message);
  if (rc === 7) {
    msg('yellow', 'skipped', 'no committable HQ changes staged');
    return 0;
  }
  if (rc !== 0) die('error', `hq ship failed during commit/push (rc=${rc})`, 1);
  msg('green', 'pushed', 'the pipeline will build -> scan -> deploy on green');
  msg('dim', 'watch', 'gh run watch   (or the Actions tab)');

  if (git(env.vault, ['status', '--porcelain']).stdout.trim() !== '') {
    msg('yellow', 'vault', 'has uncommitted changes; run vault status/sync when ready');
  }
  return 0;
};

/** Tracked edits repo-wide plus new files under the known app dirs; push is the deploy. */
function commitAndPush(cwd: string, message: string): number {
  const add = spawnSync('git', ['add', '-u'], { cwd, stdio: 'inherit' }).status ?? 1;
  if (add !== 0) return add;
  const existing = APP_DIRS.filter((dir) => pathExists(path.join(cwd, dir)));
  if (commit(cwd, message, existing) !== 0) return 7;
  return spawnSync('git', ['push', '-q', '-u', 'origin', 'HEAD'], { cwd, stdio: 'inherit' }).status ?? 1;
}

function pathExists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export const logs: Handler = (args, rt) => {
  const env = loadHqEnv();
  requireAdmin(env);
  let tail = '50';
  let follow = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-f' || arg === '--follow') follow = true;
    else if (arg === '--tail') {
      const next = args[index + 1];
      if (next === undefined || next === '') die('error', '--tail needs a number');
      tail = next;
      index += 1;
    } else if (arg.startsWith('--tail=')) tail = arg.slice('--tail='.length);
    else return rt.dieUnknown('flag', arg, 'logs');
  }
  if (!/^[0-9]+$/.test(tail)) return usageError(`--tail needs a number, got ${tail}`);
  if (follow) return runInherit('ssh', ['-t', env.sshHost, journal(tail, true)]);
  return runInherit('ssh', [env.sshHost, journal(tail, false)]);
};

export const restart: Handler = () => {
  const env = loadHqEnv();
  requireAdmin(env);
  msg('dim', 'restarting', `${WEB_UNIT} on ${env.sshHost}`);
  // The unit is Type=notify and ready only once HQ answers its health check,
  // so this returns with a healthy HQ or fails.
  const status = runInherit('ssh', [env.sshHost, `sudo systemctl restart ${WEB_UNIT}`]);
  if (status !== 0) die('error', `${WEB_UNIT} did not come back healthy — check \`hq logs\``, status);
  msg('green', 'restarted', 'severino-hq is healthy');
  return 0;
};

export const open: Handler = () => {
  const env = loadHqEnv();
  if (which('open')) return runInherit('open', [env.url]);
  msg('dim', 'open', env.url);
  return 0;
};

export const shell: Handler = () => {
  const env = loadHqEnv();
  requireAdmin(env);
  return runInherit('ssh', ['-t', env.sshHost, containerManage(env.container, 'shell', 'tty')]);
};

export const superuser: Handler = () => {
  const env = loadHqEnv();
  requireAdmin(env);
  return runInherit('ssh', ['-t', env.sshHost, containerManage(env.container, 'createsuperuser', 'tty')]);
};

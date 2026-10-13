import { rmSync } from 'node:fs';
import { CliError, die } from '../sdk/cli.ts';
import { blank, header, msg } from '../sdk/output.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition, ToolRuntime } from '../sdk/tool.ts';
import { CheckReport } from '../sdk/report.ts';
import { REAPER_WARN_DAYS, cbmEnv, cbmPids, daemonPids, isDirectory, orphanedSockets, probe, reaperExposed, runtimeDirs, staleLogs, workerLogs } from './state.ts';

export const spec: ToolSpec = {
  name: 'cbm',
  description: 'Health and recovery for the codebase-memory-mcp daemon.',
  group: 'Diagnostics',
  order: 85,
  leafCommands: true,
  effect: 'read',
  synopsis: ['cbm [status] [--json] | cbm fix [--dry-run] | cbm prune [--days N]'],
  paras: [
    'codebase-memory-mcp runs a long-lived daemon and keeps its coordination state — the IPC socket, the socket identity file, and the version-cohort locks — in a runtime directory under /tmp. macOS reaps /tmp files that have gone untouched for about three days, but the daemon itself is started permanent and never exits. When the reaper deletes the identity file out from under a running daemon, that daemon becomes unverifiable while still holding the cohort locks, so a new session can neither adopt it nor start a replacement. Every MCP connect then fails with a 30-second \'CBM daemon could not start\', and index workers refuse to run with \'a pre-coordination or unverified CBM generation is active\'.',
    'Bare \'cbm\' is \'cbm status\'. Status probes the real MCP handshake rather than trusting the process list, because the failure mode is a daemon that is alive, listening, and still unusable. It also warns while the coordination files under /tmp are merely getting old, so the fix stays a five-second reset instead of a debugging session after the next reap. CBM legitimately runs a daemon out of both its /tmp and its cache runtime directory, so neither a daemon count nor a directory count is treated as a fault.',
  ],
  env: [
    { name: 'CBM_BIN', help: 'codebase-memory-mcp binary (default: the one on PATH)' },
    { name: 'CBM_CACHE_DIR', help: 'CBM cache root (default $XDG_CACHE_HOME/codebase-memory-mcp)' },
    { name: 'CBM_TMP_DIR', help: 'Reaper-exposed runtime root (default /tmp)' },
    { name: 'CBM_PGREP_BIN', help: 'Process-lookup binary (default pgrep; the test seam)' },
    { name: 'CBM_LOG_WARN_MB', help: 'Warn above this much index-worker log (default 200)' },
  ],
  examples: [
    { command: 'cbm', comment: 'is CBM actually usable right now, and why not' },
    { command: 'cbm fix', comment: 'kill wedged daemons, clear stale runtime state, verify' },
    { command: 'cbm fix --dry-run', comment: 'show what recovery would touch, change nothing' },
    { command: 'cbm prune --days 7', comment: 'delete index-worker logs older than a week' },
  ],
  commands: [
    {
      name: 'status',
      summary: 'Whether the MCP handshake works, and every reason it might not',
      effect: 'read',
      options: [
        { flags: ['--json'], help: 'Machine-readable output' },
        { flags: ['--no-probe'], help: 'Skip the MCP handshake; report local state only' },
        { flags: ['--timeout'], metavar: 'SECS', help: 'Seconds to wait for the handshake (default 40)' },
      ],
    },
    {
      name: 'fix',
      summary: 'Kill wedged daemons, clear stale runtime state, verify the handshake',
      effect: 'local_write',
      options: [{ flags: ['--dry-run'], help: 'Report what would be killed and removed without doing it' }],
    },
    {
      name: 'prune',
      summary: 'Delete old index-worker logs from the CBM cache',
      effect: 'local_write',
      options: [{ flags: ['--days'], metavar: 'N', help: 'Keep logs newer than N days (default 14)' }],
    },
  ],
};

const MB = 1_048_576;

function valueAfter(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value === '') throw new CliError(`${flag} needs a value`, 1);
  return value;
}

async function status(args: readonly string[], rt: ToolRuntime): Promise<number> {
  let json = false;
  let doProbe = true;
  let timeout = '40';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--json') json = true;
    else if (arg === '--no-probe') doProbe = false;
    else if (arg === '--timeout') {
      timeout = valueAfter(args, index, '--timeout');
      index += 1;
    } else rt.dieUnknown('option', arg, 'status');
  }

  const env = cbmEnv();
  const handshake = doProbe ? await probe(env, Number(timeout) || 0) : 'skipped';
  const daemons = daemonPids(env).length;
  const orphans = orphanedSockets(env).length;
  const exposed = reaperExposed(env).length;
  const logs = workerLogs(env);
  const logBytes = logs.reduce((sum, log) => sum + log.size, 0);
  const warnMb = Number(process.env['CBM_LOG_WARN_MB'] || '200');

  const report = new CheckReport(json);
  let failed = false;
  if (handshake === 'skipped') report.warn('MCP handshake', 'not probed (--no-probe)');
  else if (!report.check('MCP handshake', handshake === 'ok', `${handshake}, ${daemons} daemon(s)`)) failed = true;
  if (!report.check('socket identity intact', orphans === 0, `${orphans} socket(s) missing their .identity`)) failed = true;
  if (exposed > 0) {
    report.warn('reaper exposure', `${exposed} identity file(s) untouched >${REAPER_WARN_DAYS}d in ${env.tmpDir} — run cbm fix before it wedges`);
  }
  if (logBytes > warnMb * MB) report.warn('index-worker logs', `${Math.floor(logBytes / MB)}MB across ${logs.length} files — cbm prune`);

  if (!json && failed) {
    blank();
    msg('yellow', 'recover', 'cbm fix');
  }
  return report.finish(failed);
}

async function fix(args: readonly string[], rt: ToolRuntime): Promise<number> {
  let dry = false;
  for (const arg of args) {
    if (arg === '--dry-run') dry = true;
    else rt.dieUnknown('option', arg, 'fix');
  }

  const env = cbmEnv();
  const pids = cbmPids(env);
  const dirs = runtimeDirs(env);

  header(dry ? 'would recover' : 'recovering', pids.length, 'PID');

  let killed = 0;
  for (const pid of pids) {
    if (dry) msg('yellow', 'would kill', `pid ${pid}`);
    else {
      try {
        process.kill(Number(pid));
        msg('green', 'killed', `pid ${pid}`);
      } catch {
        msg('yellow', 'gone', `pid ${pid}`);
      }
    }
    killed += 1;
  }

  if (!dry) await new Promise((resolve) => setTimeout(resolve, 2000));

  let removed = 0;
  for (const dir of dirs) {
    if (dry) msg('yellow', 'would clear', dir);
    else {
      rmSync(dir, { recursive: true, force: true });
      msg('green', 'cleared', dir);
    }
    removed += 1;
  }

  if (dry) {
    blank();
    msg('yellow', 'dry-run', `${killed} process(es), ${removed} runtime dir(s) — nothing changed`);
    blank();
    return 0;
  }

  const handshake = await probe(env, 40);
  blank();
  if (handshake === 'ok') {
    msg('green', 'verified', 'MCP handshake succeeds — restart your editor session to reconnect');
    blank();
    return 0;
  }
  msg('red', 'failed', `handshake still ${handshake} — check ${env.logDir}/cbm-daemon.log`);
  blank();
  return 1;
}

function prune(args: readonly string[], rt: ToolRuntime): number {
  let days = '14';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--days') {
      days = valueAfter(args, index, '--days');
      index += 1;
    } else rt.dieUnknown('option', arg, 'prune');
  }

  const env = cbmEnv();
  const logs = workerLogs(env);
  if (!isDirectory(env.logDir)) die('error', `no CBM log directory: ${env.logDir}`);

  const stale = staleLogs(logs, days);
  if (stale.length === 0) {
    header('pruned', 0, 'log');
    msg('green', 'clean', `no index-worker logs older than ${days}d`);
    blank();
    return 0;
  }

  const bytes = stale.reduce((sum, log) => sum + log.size, 0);
  for (const log of stale) rmSync(log.path, { force: true });

  header('pruned', stale.length, 'log');
  msg('green', 'reclaimed', `${Math.floor(bytes / MB)}MB from ${env.logDir}`);
  blank();
  return 0;
}

const handler: Handler = (args, rt) => {
  const [first, ...rest] = args;
  switch (first ?? 'status') {
    case 'status': return status(rest, rt);
    case 'fix': return fix(rest, rt);
    case 'prune': return prune(rest, rt);
    default: return rt.dieUnknown('command', first ?? '');
  }
};

export const tool: ToolDefinition = { spec, run: handler };

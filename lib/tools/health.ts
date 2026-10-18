// `tools doctor`: environment, dependencies, contracts and installed symlinks.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { isRecord } from '../sdk/guards.ts';
import { blank, palette } from '../sdk/output.ts';
import { exportedToolsHome, toolsHome } from '../sdk/paths.ts';
import { run, runJson } from '../sdk/process.ts';
import { fingerprintVerdicts } from './capabilities.ts';
import { summarize } from './contract-summary.ts';
import { CheckReport } from '../sdk/report.ts';
import { installDir } from './install.ts';
import { which } from '../sdk/which.ts';

export interface DoctorOptions {
  json: boolean;
  all: boolean;
  live: boolean;
  names: readonly string[];
  vault: string;
  inbox: string;
}

function isDirectory(candidate: string): boolean {
  return candidate !== '' && existsSync(candidate) && statSync(candidate).isDirectory();
}

function describes(home: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const env = { ...process.env, NOTES_HOME: process.env['NOTES_HOME'] || home, BACKUPS_HOME: process.env['BACKUPS_HOME'] || home };
    const child = spawn(path.join(home, 'bin', name), ['--describe'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    let head = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { if (head.length < 16) head += chunk; });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0 && head.startsWith('{"ok":true')));
  });
}

function contractVerdict(scope: string, home: string): { ok: boolean; detail: string } {
  const result = run('node', [path.join(home, 'lib/tools/contracts.ts'), '--check', '--scope', scope, '--json']);
  const text = result.stdout.trim();
  if (!text) return { ok: false, detail: 'contract graph unavailable' };
  try {
    return summarize(JSON.parse(text));
  } catch {
    return { ok: false, detail: 'contract graph unavailable' };
  }
}

/** HQ's own verdict from get_findings: clean when its summary counts none. */
export function findingsVerdict(result: unknown): { ok: boolean; detail: string } {
  const summary = isRecord(result) ? result['summary'] : undefined;
  const count = isRecord(summary) ? summary['findings'] : undefined;
  if (typeof count !== 'number') return { ok: false, detail: 'HQ answered get_findings without a summary' };
  if (count === 0) return { ok: true, detail: 'HQ claims nothing is wrong' };
  const severities = isRecord(summary) && isRecord(summary['severities']) ? summary['severities'] : {};
  const bySeverity = Object.entries(severities).map(([severity, n]) => `${String(n)} ${severity}`).join(', ');
  return { ok: false, detail: `${count} finding(s)${bySeverity ? ` (${bySeverity})` : ''}; read them: hq call get_findings` };
}

function hqFindings(home: string): { ok: boolean; detail: string } {
  const result = runJson(path.join(home, 'bin/hq'), ['call', 'get_findings']);
  if (!result.ok) return { ok: false, detail: result.error || 'HQ did not answer get_findings' };
  return findingsVerdict(result.json);
}

export async function runDoctor(options: DoctorOptions, home = toolsHome): Promise<number> {
  const doctor = new CheckReport(options.json);
  const dir = installDir();
  let failed = false;
  const record = (ok: boolean): void => {
    if (!ok) failed = true;
  };
  if (!options.json) blank();

  const env: [string, string | undefined][] = [
    ['TOOLS_HOME', exportedToolsHome],
    ['NOTES_HOME', process.env['NOTES_HOME']],
    ['BACKUPS_HOME', process.env['BACKUPS_HOME']],
  ];
  for (const [name, value] of env) {
    record(value ? doctor.check(`$${name}`, true, value) : doctor.check(`$${name}`, false, 'not exported in current shell'));
  }
  record(doctor.check('VAULT directory', isDirectory(options.vault), options.vault || 'unset'));
  record(doctor.check('INBOX_DIR', isDirectory(options.inbox), options.inbox || 'unset'));

  for (const command of ['git', 'rsync', 'uv']) {
    const found = which(command);
    record(found ? doctor.check(command, true, found) : doctor.check(command, false, 'not installed'));
  }

  const op = which('op');
  if (op) doctor.check('1Password CLI', true, op);
  else record(doctor.check('1Password CLI', false, 'not installed — install the 1Password CLI'));

  const node = which('node');
  if (node) {
    doctor.check('node', true, node);
    if (existsSync(path.join(home, 'package.json')) && !existsSync(path.join(home, 'node_modules'))) {
      doctor.warn('node_modules', 'missing — run: npm ci (needed by doc-to-pdf and diagram)');
    }
  } else doctor.warn('node', 'not installed — doc-to-pdf, diagram, and the TUIs need it');

  const described = await Promise.all(options.names.map((name) => describes(home, name)));
  const missing = options.names.filter((_, index) => !described[index]);
  if (missing.length === 0) doctor.check('tools self-describe', true, `${options.names.length} tools emit --describe`);
  else record(doctor.check('tools self-describe', false, `no --describe contract: ${missing.join(' ')}`));

  const scope = options.live ? 'live' : options.all ? 'fleet' : 'local';
  const contracts = contractVerdict(scope, home);
  record(doctor.check('contract projections', contracts.ok, contracts.detail));

  const matched: string[] = [];
  const stale: string[] = [];
  for (const [id, status, detail] of fingerprintVerdicts()) {
    if (status === 'match') matched.push(`${id} ${detail}`);
    else if (status !== 'skip') stale.push(`${id} (${detail})`);
  }
  if (stale.length) record(doctor.check('installed tools', false, `${stale.join(' ')} — run: tools reinstall`));
  else if (matched.length) doctor.check('installed tools', true, `${matched.join(', ')} match source`);

  for (const name of options.names) {
    const link = path.join(dir, name);
    const expected = path.join(home, 'bin', name);
    let isLink = false;
    try {
      isLink = lstatSync(link).isSymbolicLink();
    } catch {
      isLink = false;
    }
    if (!isLink) record(doctor.check(`${name} symlink`, false, `not in ${dir} (run: tools install)`));
    else {
      const target = readlinkSync(link);
      if (target === expected) doctor.check(`${name} symlink`, true, link);
      else record(doctor.check(`${name} symlink`, false, `points to ${target}, expected ${expected}`));
    }
  }

  if (options.all) {
    if (!options.json) {
      blank();
      const p = palette();
      process.stdout.write(`  ${p.BOLD}systems${p.RESET}\n`);
    }
    record(doctor.gate('hq doctor', [path.join(home, 'bin/hq'), 'doctor']));
    if (options.live) {
      const findings = hqFindings(home);
      record(doctor.check('hq findings', findings.ok, findings.detail));
    } else doctor.warn('hq findings', 'skipped: it asks HQ over SSH; rerun with --live');
  }

  return doctor.finish(failed);
}

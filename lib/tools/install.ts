import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { die, exit } from '../sdk/cli.ts';
import { blank, msg, palette } from '../sdk/output.ts';
import { toolsHome } from '../sdk/paths.ts';
import { runInherit } from '../sdk/process.ts';
import { capabilityPaths, fingerprintVerdicts, installPlan } from './capabilities.ts';
import { which } from '../sdk/which.ts';

/** Names of the executables in bin/, in sorted order. */
export function toolNames(home = toolsHome): string[] {
  const bin = path.join(home, 'bin');
  if (!existsSync(bin)) return [];
  return readdirSync(bin)
    .sort()
    .filter((name) => {
      const info = statSync(path.join(bin, name));
      return info.isFile() && (info.mode & 0o111) !== 0;
    });
}

export function installDir(): string {
  return process.env['TOOLS_INSTALL_DIR'] || path.join(process.env['HOME'] ?? '', '.local/bin');
}

function isSymlink(candidate: string): boolean {
  try {
    return lstatSync(candidate).isSymbolicLink();
  } catch {
    return false;
  }
}

export function runInstall(names: readonly string[], dir = installDir(), home = toolsHome): number {
  const p = palette();
  mkdirSync(dir, { recursive: true });
  blank();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const name of names) {
    const source = path.join(home, 'bin', name);
    const target = path.join(dir, name);
    let executable = false;
    try {
      executable = (statSync(source).mode & 0o111) !== 0 && statSync(source).isFile();
    } catch {
      executable = false;
    }
    if (!executable) {
      msg('red', 'skipped', `${name} ${p.DIM}(not executable at ${source})${p.RESET}`);
      skipped += 1;
      continue;
    }
    if (isSymlink(target)) {
      if (readlinkSync(target) === source) {
        msg('dim', 'ok', `${name} ${p.DIM}(already linked)${p.RESET}`);
        skipped += 1;
        continue;
      }
      unlinkSync(target);
      symlinkSync(source, target);
      msg('yellow', 'updated', `${name} ${p.DIM}→ ${source}${p.RESET}`);
      updated += 1;
    } else if (existsSync(target)) {
      msg('red', 'skipped', `${name} ${p.DIM}(${target} exists, not a symlink)${p.RESET}`);
      skipped += 1;
    } else {
      symlinkSync(source, target);
      msg('green', 'linked', `${name} ${p.DIM}→ ${source}${p.RESET}`);
      created += 1;
    }
  }
  blank();
  process.stdout.write(`  ${p.BOLD}install${p.RESET}    ${created} created, ${updated} updated, ${skipped} skipped\n\n`);
  if (!`:${process.env['PATH'] ?? ''}:`.includes(`:${dir}:`)) {
    process.stdout.write(`  ${p.BOLD}${p.YELLOW}note${p.RESET}       ${dir} is not on $PATH — add it in ~/.zshrc\n\n`);
  }
  return 0;
}

function reinstallRepo(id: string): boolean {
  const plan = installPlan(id);
  if (!plan) return die('error', `${id} declares no install in config/capabilities.json`);
  if (!existsSync(plan.path) || !statSync(plan.path).isDirectory()) die('error', `${id} checkout not found: ${plan.path}`);
  const [bin = '', ...args] = plan.command;
  const program = bin === 'uv' ? process.env['UV_BIN'] || 'uv' : bin;
  if (!which(program)) die('error', `${id} installs with ${program}, which is not installed`);
  msg('dim', 'step', `${id}: ${[program, ...args].join(' ')}`);
  const status = runInherit(program, args, { cwd: plan.path });
  if (status !== 0) exit(status);
  const [verdict] = fingerprintVerdicts(id);
  const [, state = '', detail = ''] = verdict ?? [id, 'skip', ''];
  if (state === 'match') msg('green', 'reinstalled', `${id} ${detail}`);
  else if (state === 'skip') msg('green', 'reinstalled', id);
  else {
    msg('red', 'stale', `${id}: ${detail}`);
    return false;
  }
  return true;
}

export function runReinstall(requested: string | undefined): number {
  const ids = requested === undefined ? capabilityPaths('install').map((entry) => entry.id) : [requested];
  let failed = false;
  for (const id of ids) {
    if (!reinstallRepo(id)) failed = true;
  }
  if (failed) die('error', 'an installed tool still differs from its source', 1);
  msg('dim', 'note', 'reconnect long-running MCP clients only if their tool schema must refresh');
  return 0;
}

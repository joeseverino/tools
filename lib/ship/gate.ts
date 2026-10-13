import { existsSync, readFileSync, statSync, accessSync, constants } from 'node:fs';
import path from 'node:path';
import { parseJson } from '../sdk/guards.ts';
import { gateScript } from './gate-script.ts';

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The argv of a repo's own local gate, or null when it declares none. First match wins. */
export function shipGate(repo: string): string[] | null {
  if (executable(path.join(repo, 'bin/tools'))) return ['tools', 'check', '--ci', '--no-bench'];
  if (existsSync(path.join(repo, 'scripts/check.sh'))) return ['bash', 'scripts/check.sh'];
  const manifest = path.join(repo, 'package.json');
  if (!existsSync(manifest)) return null;
  let runner = ['npm', 'run'];
  if (existsSync(path.join(repo, 'pnpm-lock.yaml'))) runner = ['pnpm', 'run'];
  if (existsSync(path.join(repo, 'yarn.lock'))) runner = ['yarn'];
  if (existsSync(path.join(repo, 'bun.lockb')) || existsSync(path.join(repo, 'bun.lock'))) runner = ['bun', 'run'];
  let script = '';
  try {
    script = gateScript(parseJson(readFileSync(manifest, 'utf8')));
  } catch {
    script = '';
  }
  return script ? [...runner, script] : null;
}

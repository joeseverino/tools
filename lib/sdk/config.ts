// Per-tool defaults live in config/<name>.sh so they stay shell-sourceable and
// overridable from the environment. A local config/<name>.sh wins; without one
// the tracked config/<name>.sh.example applies.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SilentExit } from './cli.ts';
import { toolsHome } from './paths.ts';

export interface ShellConfigRequest {
  scalars?: readonly string[];
  arrays?: readonly string[];
}

export interface ShellConfig {
  /** Undefined when the config left the variable unset. */
  scalars: Record<string, string | undefined>;
  arrays: Record<string, string[]>;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function configFile(name: string, home = toolsHome): string {
  const local = path.join(home, 'config', `${name}.sh`);
  return existsSync(local) ? local : `${local}.example`;
}

// The script is constant: the config file and the variable names arrive as
// positional arguments, never as part of the command text.
const SCRIPT = `set -eu
source "$1"
shift
set +u
for spec; do
  kind=\${spec%%:*}
  name=\${spec#*:}
  if [ "$kind" = S ]; then
    if [ -n "\${!name+x}" ]; then printf 'S\\0%s\\0%s\\0' "$name" "\${!name}"; fi
  else
    ref="\${name}[@]"
    count=0
    for item in "\${!ref}"; do count=$((count + 1)); done
    printf 'A\\0%s\\0%s\\0' "$name" "$count"
    for item in "\${!ref}"; do printf '%s\\0' "$item"; done
  fi
done`;

function specs(request: ShellConfigRequest): string[] {
  const names = [...(request.scalars ?? []), ...(request.arrays ?? [])];
  for (const name of names) if (!NAME.test(name)) throw new Error(`invalid config variable: ${name}`);
  return [...(request.scalars ?? []).map((name) => `S:${name}`), ...(request.arrays ?? []).map((name) => `A:${name}`)];
}

export function parseConfigOutput(output: string): ShellConfig {
  const fields = output.split('\0');
  const config: ShellConfig = { scalars: {}, arrays: {} };
  let index = 0;
  while (index < fields.length) {
    const kind = fields[index++];
    if (kind === 'S') {
      const name = fields[index++] ?? '';
      config.scalars[name] = fields[index++] ?? '';
    } else if (kind === 'A') {
      const name = fields[index++] ?? '';
      const count = Number(fields[index++] ?? 0);
      config.arrays[name] = fields.slice(index, index + count);
      index += count;
    } else break;
  }
  return config;
}

/** Sources an explicit shell file and returns the requested variables. */
export function loadShellFile(file: string, request: ShellConfigRequest, home = toolsHome): ShellConfig {
  const result = spawnSync('bash', ['-c', SCRIPT, 'config', file, ...specs(request)], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, TOOLS_HOME: home },
  });
  if (result.status !== 0) throw new SilentExit(result.status ?? 1);
  return parseConfigOutput(result.stdout);
}

/** Sources the tool's config in bash and returns the requested variables. */
export function loadShellConfig(name: string, request: ShellConfigRequest, home = toolsHome): ShellConfig {
  return loadShellFile(configFile(name, home), request, home);
}

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { die } from '../sdk/cli.ts';
import { isRecord, parseJson } from '../sdk/guards.ts';
import { blank, msg, palette } from '../sdk/output.ts';
import { codeHome } from '../sdk/paths.ts';
import { runInherit } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { vaultTree } from '../vault/state.ts';

export const spec: ToolSpec = {
  name: 'brand',
  description: "Render Joe's brand kits via the branding-engine.",
  group: 'Integrations',
  order: 150,
  effect: 'read',
  synopsis: ['brand <command>'],
  paras: [
    'Kits land in $BRAND_HOME/kits. The engine (branding-engine) comes in as a pinned dependency of the brand repo; see its README for all flags.',
  ],
  env: [
    { name: 'CODE_HOME', help: 'Root holding Projects/ and Assets/ (default: two levels above TOOLS_HOME)' },
    { name: 'BRAND_HOME', help: 'Defaults to $CODE_HOME/Assets/severino-brand' },
  ],
  commands: [
    {
      name: 'build',
      summary: 'Rebuild every kit from brand/ + the social cards',
      effect: 'local_write',
      delegates: 'severino-brand — surface owned by its cordon emitter (contract/brand.json); flags by branding-engine',
    },
    {
      name: 'kit',
      summary: 'Render a one-off kit into severino-brand/kits/<slug>',
      effect: 'local_write',
      delegates:
        'severino-brand — positionals slug/hex/initials/wordmark and flags live in its cordon emitter (contract/brand.json) + branding-engine',
    },
    {
      name: 'figure',
      summary: 'Render a brand-themed graphic (cover, banner, diagram) from a JSON spec',
      effect: 'local_write',
      delegates:
        'severino-brand — spec positional and flags (--out/--tokens/--scale) live in its cordon emitter (contract/brand.json) + branding-engine',
      paras: [
        'Spec format and template fields live in the engine README. --tokens defaults to the primary kit\'s. Use this for designed graphics; use `diagram` for Mermaid flowcharts and sequence diagrams.',
      ],
    },
    { name: 'status', summary: 'Show brand location, engine version, and git state', effect: 'read' },
  ],
};

function brandHome(): string {
  return process.env['BRAND_HOME'] || path.join(codeHome, 'Assets/severino-brand');
}

function isDirectory(target: string): boolean {
  return existsSync(target) && statSync(target).isDirectory();
}

function isFile(target: string): boolean {
  return existsSync(target) && statSync(target).isFile();
}

function requireBrand(home: string): void {
  if (!isDirectory(home)) die('error', `brand repo not found: ${home}`);
  if (!isFile(path.join(home, 'package.json'))) die('error', `package.json not found in ${home}`);
  if (!isDirectory(path.join(home, 'node_modules/branding-engine'))) die('error', `engine not installed; run \`npm install\` in ${home}`);
}

/** The first tokens.css (by path order) one or two levels below kits/. */
export function firstKitTokens(kitsDir: string): string {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === 'tokens.css' && depth >= 2) found.push(full);
    }
  };
  walk(kitsDir, 1);
  return found.sort()[0] ?? '';
}

/** Arguments for the engine's figure command; the primary kit's tokens apply unless --tokens is given. */
export function figureArgs(specFile: string, rest: readonly string[], defaultTokens: string): string[] {
  const hasTokens = rest.includes('--tokens');
  return !hasTokens && defaultTokens !== '' && isFile(defaultTokens)
    ? ['figure', specFile, '--tokens', defaultTokens, ...rest]
    : ['figure', specFile, ...rest];
}

function engineVersion(packageJson: string): string {
  try {
    const parsed = parseJson(readFileSync(packageJson, 'utf8'));
    return isRecord(parsed) && typeof parsed['version'] === 'string' ? parsed['version'] : '';
  } catch {
    return '';
  }
}

const build: Handler = (args) => {
  const home = brandHome();
  requireBrand(home);
  msg('dim', 'brand', home);
  return runInherit('npm', ['run', '-s', 'build', '--', ...args], { cwd: home });
};

const kit: Handler = (args, rt) => {
  if (args.length < 3) {
    rt.printUsage('kit');
    return 0;
  }
  const home = brandHome();
  requireBrand(home);
  msg('dim', 'brand', home);
  return runInherit('npm', ['run', '-s', 'kit', '--', ...args], { cwd: home });
};

const figure: Handler = (args, rt) => {
  if (args.length < 1) {
    rt.printUsage('figure');
    return 0;
  }
  const home = brandHome();
  requireBrand(home);
  const [specFile = '', ...rest] = args;
  if (!isFile(specFile)) die('error', `spec not found: ${specFile}`);
  // npm links the engine's declared bin here, wherever the package keeps it.
  const engine = path.join(home, 'node_modules/.bin/branding-engine');
  if (!isFile(engine)) die('error', `engine not installed; run \`npm install\` in ${home}`);

  let defaultTokens = path.join(home, 'kits/joe-severino/web/tokens.css');
  if (!isFile(defaultTokens)) defaultTokens = firstKitTokens(path.join(home, 'kits'));

  msg('dim', 'engine', path.join(home, 'node_modules/branding-engine'));
  return runInherit('node', [engine, ...figureArgs(specFile, rest, defaultTokens)]);
};

const status: Handler = () => {
  const home = brandHome();
  requireBrand(home);
  const p = palette();
  blank();
  msg('plain', 'brand', home);
  msg('plain', 'engine', `branding-engine ${engineVersion(path.join(home, 'node_modules/branding-engine/package.json')) || 'unknown'}`);
  if (isDirectory(path.join(home, '.git'))) {
    const tree = vaultTree(home);
    msg('plain', 'git', `${tree === 'clean' ? p.GREEN : p.YELLOW}${tree}${p.RESET}`);
  }
  const kits = path.join(home, 'kits');
  if (isDirectory(kits)) {
    const count = readdirSync(kits, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
    msg('green', 'kits', `${count} present`);
  } else {
    msg('yellow', 'kits', 'none built');
  }
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, commands: { build, kit, figure, status } };

// `tools describe`: every tool's --describe federated into one document, with a
// content-keyed cache because the document is byte-deterministic.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA_VERSION } from '../sdk/surface.ts';
import { codeHome, toolsHome } from '../sdk/paths.ts';
import { runCapability } from './capabilities.ts';

interface Described {
  ok: boolean;
  stdout: string;
}

function describeTool(home: string, name: string): Promise<Described> {
  return new Promise((resolve) => {
    const child = spawn(path.join(home, 'bin', name), ['--describe'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', () => resolve({ ok: false, stdout: '' }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout: stdout.replace(/\n+$/, '') }));
  });
}

function filesUnder(dir: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full, accept));
    else if (entry.isFile() && accept(entry.name)) found.push(full);
  }
  return found;
}

export function obsidianContractPath(): string {
  return path.join(codeHome, 'Projects/severino-obsidian/contract/obsidian-commands.json');
}

/** Hash of every input that can change the federated document. */
export function sourceSignature(home: string, withSiblings: boolean): string {
  const hash = createHash('sha256');
  const add = (file: string): void => {
    hash.update(file.slice(home.length));
    hash.update(readFileSync(file));
  };
  for (const file of filesUnder(path.join(home, 'bin'), () => true)) add(file);
  for (const file of filesUnder(path.join(home, 'lib'), (name) => name.endsWith('.ts') || name.endsWith('.sh'))) add(file);
  if (withSiblings) {
    add(path.join(home, 'config/capabilities.json'));
    const obsidian = obsidianContractPath();
    if (existsSync(obsidian) && statSync(obsidian).isFile()) hash.update(readFileSync(obsidian));
  }
  return hash.digest('hex').slice(0, 24);
}

function siblingObjects(): string {
  const objects = runCapability('describe').map((entry) => JSON.stringify(entry));
  const obsidian = obsidianContractPath();
  if (existsSync(obsidian)) {
    const text = readFileSync(obsidian, 'utf8').replace(/\n+$/, '');
    if (text.startsWith('{')) objects.push(text);
  }
  return `[${objects.join(',')}]`;
}

export interface FederateOptions {
  names: readonly string[];
  withSiblings: boolean;
  home?: string;
}

/** The compact federated document, from cache when the sources are unchanged. */
export async function federate(options: FederateOptions): Promise<string> {
  const home = options.home ?? toolsHome;
  const cacheDir = path.join(process.env['XDG_CACHE_HOME'] || path.join(os.homedir(), '.cache'), 'severino-tools');
  let cacheFile = '';
  if (!process.env['TOOLS_DESCRIBE_NO_CACHE']) {
    try {
      cacheFile = path.join(cacheDir, `describe-${sourceSignature(home, options.withSiblings)}${options.withSiblings ? '-repos' : ''}.json`);
      if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8').replace(/\n+$/, '');
    } catch {
      cacheFile = '';
    }
  }

  const results = await Promise.all(options.names.map((name) => describeTool(home, name)));
  const objects = results.map((result, index) =>
    result.ok && result.stdout.startsWith('{')
      ? result.stdout
      : JSON.stringify({ ok: false, name: options.names[index] ?? '', error: 'tool did not emit a describe contract' }),
  );
  const siblings = options.withSiblings ? `,"siblings":${siblingObjects()}` : '';
  const body = `{"ok":true,"schema_version":${SCHEMA_VERSION},"repo":"tools","tools":[${objects.join(',')}]${siblings}}`;

  if (cacheFile) {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cacheFile, `${body}\n`);
    } catch {
      // the cache is best-effort
    }
  }
  return body;
}

/** Re-indents a compact document with four spaces. */
export function prettify(body: string): string {
  return JSON.stringify(JSON.parse(body), null, 4);
}

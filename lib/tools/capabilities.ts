import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isRecord } from '../sdk/guards.ts';
import { runJson } from '../sdk/process.ts';
import { codeHome, toolsHome } from '../sdk/paths.ts';

const manifestPath = process.env['TOOLS_CAPABILITIES'] || path.join(toolsHome, 'config/capabilities.json');

// A non-empty argv: [bin, ...args].
export type Command = [string, ...string[]];

export interface Fingerprint {
  installed: Command;
  source: Command;
}

// Capability keys are open-ended: a command (argv), a flag, or other data.
export interface Repository {
  id: string;
  path: string;
  fingerprint?: Fingerprint;
  [capability: string]: unknown;
}

export interface CapabilitiesManifest {
  capabilities_version: number;
  repositories: Repository[];
}

export interface RepositoryEntry {
  id: string;
  path: string;
}

export type VerdictStatus = 'match' | 'stale' | 'missing' | 'skip';
export type Verdict = [id: string, status: VerdictStatus, detail: string];

export function isCommand(value: unknown): value is Command {
  return Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string');
}

function isCommandPair(value: unknown): value is Fingerprint {
  return isRecord(value) && isCommand(value['installed']) && isCommand(value['source']);
}

function isRepository(value: unknown): value is Repository {
  return isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['path'] === 'string'
    && (value['fingerprint'] === undefined || isCommandPair(value['fingerprint']));
}

function isManifest(value: unknown): value is CapabilitiesManifest {
  return isRecord(value)
    && value['capabilities_version'] === 1
    && Array.isArray(value['repositories'])
    && value['repositories'].every(isRepository);
}

export function loadCapabilities(): CapabilitiesManifest {
  const data: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!isManifest(data)) throw new Error(`unsupported capabilities manifest: ${manifestPath}`);
  return data;
}

function repoPath(repo: Repository): string {
  const overrides: Record<string, string | undefined> = {
    'severino-vault-mcp': process.env['MCP_HOME'],
    'severino-life': process.env['LIFE_MCP_HOME'],
    'vault-engine': process.env['VAULT_ENGINE_HOME'],
  };
  const override = overrides[repo.id];
  return override || path.join(codeHome, repo.path);
}

export function capabilityPaths(capability: string): RepositoryEntry[] {
  return loadCapabilities().repositories
    .filter((repo) => repo[capability] === true || repo[capability] != null)
    .map((repo) => ({ id: repo.id, path: repoPath(repo) }));
}

export function repositoryEntries(): RepositoryEntry[] {
  return loadCapabilities().repositories.map((repo) => ({ id: repo.id, path: repoPath(repo) }));
}

export function repositoryCapability(id: string, capability: string): Command | null {
  const repo = loadCapabilities().repositories.find((entry) => entry.id === id);
  const command = repo?.[capability];
  return isCommand(command) ? command : null;
}

export function runCapability(capability: string): object[] {
  const results: object[] = [];
  for (const repo of loadCapabilities().repositories) {
    const command = repo[capability];
    if (!isCommand(command)) continue;
    const [bin, ...args] = command;
    const result = runJson(bin, args, { cwd: repoPath(repo) });
    if (result.ok && result.json && typeof result.json === 'object') results.push(result.json);
  }
  return results;
}

// One verdict per repository that declares a fingerprint: match, stale,
// missing (not installed or no checkout), or skip (nothing declared). Both
// sides run the repository's own command, so the hash scheme lives in one place.
export function fingerprintVerdicts(onlyId?: string): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const repo of loadCapabilities().repositories) {
    if (onlyId && repo.id !== onlyId) continue;
    const fp = repo.fingerprint;
    if (!fp) { if (onlyId) verdicts.push([repo.id, 'skip', '']); continue; }
    const cwd = repoPath(repo);
    if (!fs.existsSync(cwd)) { verdicts.push([repo.id, 'missing', `no checkout at ${cwd}`]); continue; }
    const report = (command: Command, options: { cwd?: string }): string => {
      const [bin, ...args] = command;
      const run = spawnSync(bin, args, { encoding: 'utf8', ...options });
      return run.status === 0 ? run.stdout.trim().split('\n').at(-1) ?? '' : '';
    };
    const installed = report(fp.installed, {});
    const source = report(fp.source, { cwd });
    if (!installed) verdicts.push([repo.id, 'missing', `${fp.installed[0]} is not installed or cannot report a fingerprint`]);
    else if (!source) verdicts.push([repo.id, 'missing', 'the checkout cannot report a fingerprint']);
    else if (installed === source) verdicts.push([repo.id, 'match', source]);
    else verdicts.push([repo.id, 'stale', `installed ${installed}, source ${source}`]);
  }
  return verdicts;
}

function main() {
  const [action, capability] = process.argv.slice(2);
  if (action === 'paths' && capability) {
    for (const entry of capabilityPaths(capability)) process.stdout.write(entry.path + '\n');
    return;
  }
  if (action === 'ids' && capability) {
    for (const entry of capabilityPaths(capability)) process.stdout.write(entry.id + '\n');
    return;
  }
  if (action === 'pairs' && capability) {
    for (const entry of capabilityPaths(capability)) process.stdout.write(`${entry.id}\t${entry.path}\n`);
    return;
  }
  if (action === 'install' && capability) {
    const repo = loadCapabilities().repositories.find((entry) => entry.id === capability);
    const command = repositoryCapability(capability, 'install');
    if (!repo || !command) { process.exitCode = 1; return; }
    process.stdout.write([repoPath(repo), ...command].join('\t') + '\n');
    return;
  }
  if (action === 'fingerprints') {
    for (const verdict of fingerprintVerdicts(capability)) process.stdout.write(verdict.join('\t') + '\n');
    return;
  }
  if (action === 'run-all' && capability) {
    process.stdout.write(JSON.stringify(runCapability(capability)) + '\n');
    return;
  }
  if (action === 'manifest') {
    process.stdout.write(JSON.stringify(loadCapabilities()) + '\n');
    return;
  }
  process.stderr.write('usage: capabilities.ts <paths|ids|pairs|run-all> <capability> | install <id> | fingerprints [id] | manifest\n');
  process.exitCode = 2;
}

if (import.meta.main) main();

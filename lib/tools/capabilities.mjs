import fs from 'node:fs';
import path from 'node:path';
import { runJson } from '../sdk/process.mjs';

const toolsHome = process.env.TOOLS_HOME || path.resolve(import.meta.dirname, '../..');
const codeHome = process.env.CODE_HOME || path.resolve(toolsHome, '../..');
const manifestPath = process.env.TOOLS_CAPABILITIES || path.join(toolsHome, 'config/capabilities.json');

export function loadCapabilities() {
  const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (data.capabilities_version !== 1 || !Array.isArray(data.repositories)) {
    throw new Error(`unsupported capabilities manifest: ${manifestPath}`);
  }
  return data;
}

function repoPath(repo) {
  const override = {
    'severino-vault-mcp': process.env.MCP_HOME,
    'severino-edu-mcp': process.env.EDU_MCP_HOME,
    'severino-life': process.env.LIFE_MCP_HOME,
    'vault-engine': process.env.VAULT_ENGINE_HOME,
  }[repo.id];
  return override || path.join(codeHome, repo.path);
}

export function capabilityPaths(capability) {
  return loadCapabilities().repositories
    .filter((repo) => repo[capability] === true || repo[capability] != null)
    .map((repo) => ({ id: repo.id, path: repoPath(repo) }));
}

export function runCapability(capability) {
  const results = [];
  for (const repo of loadCapabilities().repositories) {
    const command = repo[capability];
    if (!Array.isArray(command) || command.length === 0) continue;
    const [bin, ...args] = command;
    const result = runJson(bin, args, { cwd: repoPath(repo) });
    if (result.ok && result.json && typeof result.json === 'object') results.push(result.json);
  }
  return results;
}

function main() {
  const [action, capability] = process.argv.slice(2);
  if (action === 'paths' && capability) {
    for (const entry of capabilityPaths(capability)) process.stdout.write(entry.path + '\n');
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
  process.stderr.write('usage: capabilities.mjs <paths|run-all> <capability> | manifest\n');
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) main();

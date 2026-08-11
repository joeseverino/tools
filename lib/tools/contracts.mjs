import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repositoryCapability, repositoryEntries } from './capabilities.mjs';

const toolsHome = process.env.TOOLS_HOME || path.resolve(import.meta.dirname, '../..');
const graphPath = process.env.TOOLS_CONTRACT_GRAPH || path.join(toolsHome, 'config/contracts.json');

function repositoryPaths() {
  const paths = new Map([['tools', toolsHome]]);
  for (const entry of repositoryEntries()) paths.set(entry.id, entry.path);
  return paths;
}

function loadGraph() {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const ids = new Set();
  for (const contract of graph.contracts) {
    if (ids.has(contract.id)) throw new Error(`duplicate contract id: ${contract.id}`);
    ids.add(contract.id);
  }
  const projectionIds = new Set();
  for (const projection of graph.projections) {
    if (projectionIds.has(projection.id)) throw new Error(`duplicate projection id: ${projection.id}`);
    if (!ids.has(projection.contract)) throw new Error(`unknown contract: ${projection.contract}`);
    projectionIds.add(projection.id);
  }
  return graph;
}

function resolveRepository(repository, paths) {
  const resolved = paths.get(repository);
  if (!resolved) throw new Error(`repository is not discoverable: ${repository}`);
  return resolved;
}

function fingerprintSource(source, paths) {
  const cwd = resolveRepository(source.repository, paths);
  let bytes;
  if (source.path) {
    const file = path.join(cwd, source.path);
    if (!fs.existsSync(file)) return { available: false, reason: `missing ${file}` };
    bytes = fs.readFileSync(file);
  } else {
    const command = source.capability
      ? repositoryCapability(source.repository, source.capability)
      : source.argv;
    if (!command) return { available: false, reason: `missing capability ${source.repository}.${source.capability}` };
    const [bin, ...args] = command;
    const executable = bin.includes('/') ? path.join(cwd, bin) : bin;
    const result = spawnSync(executable, args, { cwd, encoding: null, env: process.env });
    if (result.status !== 0) {
      const detail = String(result.stderr || '').trim().split('\n').at(-1) || `exit ${result.status}`;
      return { available: false, reason: detail };
    }
    bytes = result.stdout;
  }
  return { available: true, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function checkProjection(projection, paths) {
  const cwd = resolveRepository(projection.check.repository, paths);
  const [bin, ...args] = projection.check.argv;
  const executable = bin.includes('/') ? path.join(cwd, bin) : bin;
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', env: process.env });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return {
    ...projection,
    ok: result.status === 0,
    status: result.status,
    detail: output.split('\n').filter(Boolean).at(-1) || (result.status === 0 ? 'current' : `exit ${result.status}`),
  };
}

const scopeRank = { local: 0, fleet: 1, live: 2 };

export function inspectContracts({ check = false, scope = 'fleet' } = {}) {
  const graph = loadGraph();
  const paths = repositoryPaths();
  const projectionsInScope = graph.projections.filter((projection) => scopeRank[projection.scope] <= scopeRank[scope]);
  const relevantContracts = new Set(projectionsInScope.map((projection) => projection.contract));
  const contracts = graph.contracts.map((contract) => ({
    ...contract,
    fingerprint: check && !relevantContracts.has(contract.id)
      ? { available: false, skipped: true, reason: `outside ${scope} scope` }
      : fingerprintSource(contract.source, paths),
  }));
  const sources = new Map(contracts.map((contract) => [contract.id, contract.fingerprint]));
  const projections = check
    ? projectionsInScope.map((projection) => {
      const source = sources.get(projection.contract);
      if (!source?.available) return { ...projection, ok: true, skipped: true, detail: source?.reason || 'source unavailable' };
      return checkProjection(projection, paths);
    })
    : graph.projections;
  return {
    ok: projections.every((projection) => projection.ok !== false),
    contract_graph_version: graph.contract_graph_version,
    contracts,
    projections,
  };
}

function renderText(result) {
  process.stdout.write('\n  contracts  producer → consumer graph\n\n');
  for (const contract of result.contracts) {
    const fingerprint = contract.fingerprint.available
      ? contract.fingerprint.sha256.slice(0, 12)
      : `unavailable: ${contract.fingerprint.reason}`;
    process.stdout.write(`  ${contract.id}\n    owner ${contract.owner} · ${fingerprint}\n`);
    for (const projection of result.projections.filter((item) => item.contract === contract.id)) {
      const status = projection.skipped ? 'unavailable' : projection.ok === undefined ? 'declared' : projection.ok ? 'current' : 'drifted';
      process.stdout.write(`    → ${projection.consumer}/${projection.id} · ${status}\n`);
    }
  }
  process.stdout.write('\n');
}

function main() {
  const args = process.argv.slice(2);
  let check = false;
  let json = false;
  let scope = 'fleet';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--check') check = true;
    else if (args[index] === '--json') json = true;
    else if (args[index] === '--scope' && args[index + 1]) scope = args[++index];
    else throw new Error(`unknown option: ${args[index]}`);
  }
  if (!(scope in scopeRank)) throw new Error(`unknown scope: ${scope}`);
  const result = inspectContracts({ check, scope });
  if (json) process.stdout.write(JSON.stringify(result) + '\n');
  else renderText(result);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { reportError } from '../sdk/cli.ts';
import { isRecord } from '../sdk/guards.ts';
import { toolsHome } from '../sdk/paths.ts';
import { isCommand, repositoryCapability, repositoryEntries } from './capabilities.ts';
import type { Command } from './capabilities.ts';

const graphPath = process.env['TOOLS_CONTRACT_GRAPH'] || path.join(toolsHome, 'config/contracts.json');

export type Scope = 'local' | 'fleet' | 'live';

export interface ContractSource {
  repository: string;
  path?: string;
  capability?: string;
  argv?: Command;
}

export interface Contract {
  id: string;
  owner: string;
  description: string;
  source: ContractSource;
}

export interface Invocation {
  repository: string;
  argv: Command;
}

export interface Repair extends Invocation {
  effect: string;
}

export interface Projection {
  id: string;
  contract: string;
  consumer: string;
  description: string;
  scope: Scope;
  check: Invocation;
  repair?: Repair;
}

export interface ContractGraph {
  contract_graph_version: number;
  contracts: Contract[];
  projections: Projection[];
}

export type FingerprintResult =
  | { available: true; sha256: string }
  | { available: false; reason: string; skipped?: true };

export interface ContractReport extends Contract {
  fingerprint: FingerprintResult;
}

export interface ProjectionReport extends Projection {
  ok?: boolean;
  skipped?: true;
  status?: number | null;
  detail?: string;
}

export interface CheckedProjection extends Projection {
  ok: boolean;
  status: number | null;
  detail: string;
}

export interface ContractsResult {
  ok: boolean;
  contract_graph_version: number;
  contracts: ContractReport[];
  projections: ProjectionReport[];
}

export type DeriveStatus = 'planned' | 'failed' | 'derived' | 'drifted';

export interface DeriveItem {
  id: string;
  repository: string;
  effect: string;
  invocation: string;
  status: DeriveStatus;
  detail?: string;
}

export interface DeriveResult {
  ok: boolean;
  scope: string;
  go: boolean;
  results: DeriveItem[];
}

type Paths = Map<string, string>;

function repositoryPaths(): Paths {
  const paths: Paths = new Map([['tools', toolsHome]]);
  for (const entry of repositoryEntries()) paths.set(entry.id, entry.path);
  return paths;
}

function isInvocation(value: unknown): value is Invocation {
  return isRecord(value) && typeof value['repository'] === 'string' && isCommand(value['argv']);
}

function isRepair(value: unknown): value is Repair {
  return isRecord(value)
    && typeof value['repository'] === 'string'
    && isCommand(value['argv'])
    && typeof value['effect'] === 'string';
}

function isContract(value: unknown): value is Contract {
  return isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['owner'] === 'string'
    && typeof value['description'] === 'string'
    && isRecord(value['source'])
    && typeof value['source']['repository'] === 'string';
}

function isProjection(value: unknown): value is Projection {
  return isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['contract'] === 'string'
    && typeof value['consumer'] === 'string'
    && typeof value['description'] === 'string'
    && typeof value['scope'] === 'string' && isScope(value['scope'])
    && isInvocation(value['check'])
    && (value['repair'] === undefined || isRepair(value['repair']));
}

function isContractGraph(value: unknown): value is ContractGraph {
  return isRecord(value)
    && typeof value['contract_graph_version'] === 'number'
    && Array.isArray(value['contracts']) && value['contracts'].every(isContract)
    && Array.isArray(value['projections']) && value['projections'].every(isProjection);
}

export function loadContractGraph(): ContractGraph {
  const graph: unknown = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  if (!isContractGraph(graph)) throw new Error(`invalid contract graph: ${graphPath}`);
  const ids = new Set<string>();
  for (const contract of graph.contracts) {
    if (ids.has(contract.id)) throw new Error(`duplicate contract id: ${contract.id}`);
    ids.add(contract.id);
  }
  const projectionIds = new Set<string>();
  for (const projection of graph.projections) {
    if (projectionIds.has(projection.id)) throw new Error(`duplicate projection id: ${projection.id}`);
    if (!ids.has(projection.contract)) throw new Error(`unknown contract: ${projection.contract}`);
    projectionIds.add(projection.id);
  }
  return graph;
}

function resolveRepository(repository: string, paths: Paths): string {
  const resolved = paths.get(repository);
  if (!resolved) throw new Error(`repository is not discoverable: ${repository}`);
  return resolved;
}

function fingerprintSource(source: ContractSource, paths: Paths): FingerprintResult {
  const cwd = resolveRepository(source.repository, paths);
  let bytes: Buffer;
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

function checkProjection(projection: Projection, paths: Paths): CheckedProjection {
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

const scopeRank: Record<Scope, number> = { local: 0, fleet: 1, live: 2 };

function isScope(scope: string): scope is Scope {
  return scope in scopeRank;
}

export interface InspectOptions {
  check?: boolean;
  scope?: Scope;
  id?: string | null;
}

export interface DeriveOptions {
  id?: string | null;
  all?: boolean;
  scope?: string;
  go?: boolean;
}

export function inspectContracts({ check = false, scope = 'fleet', id = null }: InspectOptions = {}): ContractsResult {
  const graph = loadContractGraph();
  const paths = repositoryPaths();
  let contractsSelected = graph.contracts;
  let projectionsSelected = graph.projections;
  if (id) {
    const contract = graph.contracts.find((item) => item.id === id);
    const projection = graph.projections.find((item) => item.id === id);
    if (!contract && !projection) throw new Error(`contract or projection not found: ${id}`);
    const contractId = contract?.id || projection?.contract;
    contractsSelected = graph.contracts.filter((item) => item.id === contractId);
    projectionsSelected = contract
      ? graph.projections.filter((item) => item.contract === contractId)
      : projection ? [projection] : [];
  }
  const projectionsInScope = projectionsSelected.filter((projection) => scopeRank[projection.scope] <= scopeRank[scope]);
  const relevantContracts = new Set(projectionsInScope.map((projection) => projection.contract));
  const contracts = contractsSelected.map((contract): ContractReport => ({
    ...contract,
    fingerprint: check && !relevantContracts.has(contract.id)
      ? { available: false, skipped: true, reason: `outside ${scope} scope` }
      : fingerprintSource(contract.source, paths),
  }));
  const sources = new Map(contracts.map((contract) => [contract.id, contract.fingerprint]));
  const projections: ProjectionReport[] = check
    ? projectionsInScope.map((projection): ProjectionReport => {
      const source = sources.get(projection.contract);
      if (!source?.available) return { ...projection, ok: true, skipped: true, detail: source?.reason || 'source unavailable' };
      return checkProjection(projection, paths);
    })
    : projectionsSelected;
  return {
    ok: projections.every((projection) => projection.ok !== false),
    contract_graph_version: graph.contract_graph_version,
    contracts,
    projections,
  };
}

export function deriveProjections({ id = null, all = false, scope = 'local', go = false }: DeriveOptions = {}): DeriveResult {
  if (scope !== 'local' && scope !== 'fleet') throw new Error(`unknown derive scope: ${scope}`);
  if (!id && !all) throw new Error('name one projection or pass --all');
  const graph = loadContractGraph();
  const paths = repositoryPaths();
  let selected = graph.projections.filter((projection) =>
    projection.repair && scopeRank[projection.scope] <= scopeRank[scope]);
  if (id) selected = selected.filter((projection) => projection.id === id);
  if (id && selected.length === 0) throw new Error(`repairable projection not found in ${scope} scope: ${id}`);
  const results: DeriveItem[] = [];
  for (const projection of selected) {
    if (!projection.repair) continue;
    const cwd = resolveRepository(projection.repair.repository, paths);
    const [bin, ...args] = projection.repair.argv;
    const executable = bin.includes('/') ? path.join(cwd, bin) : bin;
    const invocation = projection.repair.argv.map((value) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
      ? value
      : `'${value.replaceAll("'", "'\\''")}'`).join(' ');
    if (!go) {
      results.push({ id: projection.id, repository: projection.repair.repository, effect: projection.repair.effect, invocation, status: 'planned' });
      continue;
    }
    const repair = spawnSync(executable, args, { cwd, encoding: 'utf8', env: process.env });
    const output = `${repair.stdout || ''}\n${repair.stderr || ''}`.trim();
    if (repair.status !== 0) {
      results.push({ id: projection.id, repository: projection.repair.repository, effect: projection.repair.effect, invocation, status: 'failed', detail: output.split('\n').filter(Boolean).at(-1) || `exit ${repair.status}` });
      continue;
    }
    const verification = checkProjection(projection, paths);
    results.push({ id: projection.id, repository: projection.repair.repository, effect: projection.repair.effect, invocation, status: verification.ok ? 'derived' : 'drifted', detail: verification.detail });
  }
  return { ok: results.every((result) => ['planned', 'derived'].includes(result.status)), scope, go, results };
}

function renderText(result: ContractsResult): void {
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
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      scope: { type: 'string', default: 'fleet' },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1) throw new Error(`unknown option or extra id: ${positionals[1]}`);
  if (!isScope(values.scope)) throw new Error(`unknown scope: ${values.scope}`);
  const result = inspectContracts({ check: values.check, scope: values.scope, id: positionals[0] ?? null });
  if (values.json) process.stdout.write(JSON.stringify(result) + '\n');
  else renderText(result);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    reportError(error, 2);
  }
}

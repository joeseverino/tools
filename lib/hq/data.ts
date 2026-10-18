// hq commands that exchange JSON with HQ's tool contract or the vault MCP.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { die, exit, usageError } from '../sdk/cli.ts';
import { isRecord, parseJson } from '../sdk/guards.ts';
import { msg, palette } from '../sdk/output.ts';
import { git } from '../git/index.ts';
import type { Handler, ToolRuntime } from '../sdk/tool.ts';
import { failureMessage, jqText, loadHqEnv, resultOk } from './env.ts';
import type { HqEnv } from './env.ts';
import { createHelp, createRequest, doctorReport, parseInput, stateRecord, syncSummary, validateReport } from './report.ts';
import { syncFreshness, syncStateFile } from './state.ts';
import { svmc, svmcAvailable } from '../sdk/svmc.ts';
import { callTransport } from './transport.ts';

const REINSTALL = 'tools reinstall severino-vault-mcp';

function requireManifestMcp(): void {
  if (!svmcAvailable()) die('error', `severino-vault-mcp is required; run \`${REINSTALL}\``);
}

function buildManifest(vault: string): string {
  requireManifestMcp();
  const help = svmc(['--help']);
  if (!`${help.stdout}${help.stderr}`.includes('hq-manifest')) {
    die('error', `installed severino-vault-mcp is outdated; run \`${REINSTALL}\``);
  }
  const manifest = svmc(['hq-manifest', vault]);
  if (!manifest.ok) {
    process.stderr.write(manifest.stderr);
    exit(manifest.code);
  }
  return manifest.stdout;
}

export interface DriftEntry {
  key: unknown;
  kind: unknown;
  in_sync: unknown;
  health: unknown;
  reason: string;
}

function truthy(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

function healthOf(item: Record<string, unknown>): Record<string, unknown> {
  return isRecord(item['health']) ? item['health'] : {};
}

/** Resources HQ reconciles (enabled, not merely declared) that are unhealthy or lag their declaration. */
export function driftEntries(items: readonly unknown[]): { drifted: DriftEntry[]; checked: number } {
  const drifted: DriftEntry[] = [];
  let checked = 0;
  for (const item of items) {
    if (!isRecord(item) || !truthy(item['enabled'])) continue;
    const health = healthOf(item);
    if (health['state'] === 'declared') continue;
    checked += 1;
    const inSync = truthy(item['in_sync']);
    if (inSync && health['state'] === 'healthy') continue;
    const message = health['message'];
    drifted.push({
      key: item['key'] ?? null,
      kind: item['kind'] ?? null,
      in_sync: item['in_sync'] ?? null,
      health: health['label'] ?? null,
      reason: inSync
        ? (truthy(message) ? jqText(message) : '')
        : `declared generation ${jqText(item['generation'])}, last applied ${jqText(item['observed_generation'])}`,
    });
  }
  return { drifted, checked };
}

const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

/** The MCP request for `hq call`; null when the arguments are not one JSON object. */
export function callRequest(tool: string, argumentsText: string): unknown {
  const parsed = parseJson(argumentsText || '{}');
  return isRecord(parsed) ? { tool, arguments: parsed } : null;
}

export const call: Handler = (args, rt) => {
  const [tool = '', argumentsText = ''] = args;
  if (!tool) {
    rt.printUsage('call');
    return 0;
  }
  if (!TOOL_NAME.test(tool)) return usageError(`not an HQ tool name: ${tool}`);
  if (args.length > 2) return usageError("hq call <tool> ['{json}']");
  loadHqEnv();
  const request = callRequest(tool, argumentsText);
  if (request === null) return usageError('arguments must be one JSON object');
  const result = callTransport(request);
  process.stdout.write(result.stdout);
  return result.status;
};

// Everything HQ manages, each with what HQ expects and what is live. No bound in
// the query schema, so one page holds the whole estate.
export const DRIFT_REQUEST = { tool: 'list_resource', arguments: { name: 'infrastructure.resources', filters: { limit: 10000 } } };

export const drift: Handler = (args, rt) => {
  const flag = args[0] ?? '';
  if (flag !== '' && flag !== '--json') return rt.dieUnknown('flag', flag, 'drift');
  loadHqEnv();
  const response = callTransport(DRIFT_REQUEST);
  if (response.status !== 0) die('error', 'HQ did not answer list_resource infrastructure.resources');
  const result = parseJson(response.stdout);
  const items = isRecord(result) ? result['items'] : undefined;
  if (!Array.isArray(items)) return die('error', "HQ's infrastructure.resources answer has no items");
  const { drifted, checked } = driftEntries(items);
  if (flag === '--json') process.stdout.write(`${JSON.stringify(drifted)}\n`);
  else if (drifted.length === 0) msg('green', 'drift', `every resource HQ reconciles is in sync (${checked} checked)`);
  else {
    const p = palette();
    for (const entry of drifted) {
      const reason = entry.reason ? ` · ${entry.reason}` : '';
      msg('yellow', jqText(entry.kind), `${jqText(entry.key)} ${p.DIM}${jqText(entry.health)}${reason}${p.RESET}`);
    }
  }
  return drifted.length === 0 ? 0 : 1;
};

export const manifest: Handler = () => {
  const env = loadHqEnv();
  process.stdout.write(buildManifest(env.vault));
  return 0;
};

function schemaOf(): string | null {
  const result = svmc(['schema', '--json']);
  return result.ok ? result.stdout : null;
}

function readOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function indented(text: string): string {
  return `${text.replace(/\n+$/, '').split('\n').map((line) => `  ${line}`).join('\n')}\n`;
}

function checkDoc(doc: string): { ok: boolean; output: string } {
  const result = svmc(['schema', '--check-doc', doc]);
  return { ok: result.ok, output: `${result.stdout}${result.stderr}`.replace(/\n+$/, '') };
}

export const schema: Handler = (args, rt) => {
  const flag = args[0] ?? '';
  if (flag !== '' && flag !== '--check') return rt.dieUnknown('flag', flag, 'schema');
  const env = loadHqEnv();
  requireManifestMcp();
  const current = schemaOf();
  if (current === null) die('error', `installed severino-vault-mcp lacks \`schema\`; run \`${REINSTALL}\``);

  const dest = path.join(env.localPath, 'hq/domains/docs_index/schema.json');
  if (!isDirectory(path.join(env.localPath, 'hq/domains/docs_index'))) die('error', `HQ docs_index not found at ${env.localPath}/hq/domains/docs_index`);

  if (flag === '--check') {
    let failed = false;
    if (readOrNull(dest) === current) msg('green', 'ok', 'docs_index/schema.json matches the MCP');
    else {
      msg('red', 'drift', 'docs_index/schema.json is stale — run `hq schema`');
      failed = true;
    }
    if (!existsSync(env.schemaDoc) || !statSync(env.schemaDoc).isFile()) msg('yellow', 'skip', `vault schema doc not found: ${env.schemaDoc}`);
    else {
      const doc = checkDoc(env.schemaDoc);
      if (doc.ok) msg('green', 'ok', 'vault Frontmatter Schema doc matches the MCP');
      else {
        msg('red', 'drift', 'vault Frontmatter Schema doc lists stale enum values:');
        process.stdout.write(indented(doc.output));
        failed = true;
      }
    }
    if (failed) die('error', 'schema drift — fix the above', 1);
    return 0;
  }

  const written = svmc(['schema', '--json']);
  writeFileSync(dest, written.stdout);
  if (!written.ok) {
    process.stderr.write(written.stderr);
    exit(written.code);
  }
  msg('green', 'wrote', 'docs_index/schema.json (from the MCP)');
  if (existsSync(env.schemaDoc) && statSync(env.schemaDoc).isFile()) {
    const doc = checkDoc(env.schemaDoc);
    if (!doc.ok) {
      msg('yellow', 'warn', 'vault Frontmatter Schema doc lists stale enum values:');
      process.stdout.write(indented(doc.output));
      msg('dim', 'fix', `update the enum lines in ${env.schemaDoc} by hand`);
    }
  }
  msg('dim', 'next', 'commit schema.json + deploy HQ so the contract ships');
  return 0;
};

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Warns when HQ's committed schema.json lags the installed MCP; silent when it cannot tell. */
function schemaDriftWarn(env: HqEnv): void {
  if (!svmcAvailable()) return;
  const current = schemaOf();
  if (current === null) return;
  const committed = readOrNull(path.join(env.localPath, 'hq/domains/docs_index/schema.json'));
  if (committed === null) return;
  if (committed !== current) {
    msg('yellow', 'schema', 'HQ docs_index/schema.json lags the MCP — run `hq schema`, commit, deploy');
  }
}

export interface SyncOptions {
  prune: boolean;
  update: boolean;
}

export function syncRequest(manifest: unknown, options: SyncOptions): unknown {
  const prune = options.prune ? 1 : 0;
  return {
    tool: 'execute_capability',
    arguments: {
      name: 'hq.sync',
      payload: {
        manifest,
        update_existing: options.update ? 1 : 0,
        report_orphans: true,
        prune_orphans: prune,
        confirm_prune: prune,
      },
    },
  };
}

export const sync: Handler = (args, rt) => {
  const options: SyncOptions = { prune: false, update: true };
  for (const arg of args) {
    if (arg === '--prune') options.prune = true;
    else if (arg === '--no-update') options.update = false;
    else return rt.dieUnknown('flag', arg, 'sync');
  }
  const env = loadHqEnv();
  schemaDriftWarn(env);

  const dir = mkdtempSync(path.join(process.env['TMPDIR'] || tmpdir(), 'hq-manifest.'));
  const tmp = path.join(dir, 'manifest.json');
  try {
    writeFileSync(tmp, buildManifest(env.vault));
    msg('dim', 'sync', 'vault → HQ');
    const parsed = parseJson(readFileSync(tmp, 'utf8'));
    if (parsed === undefined) {
      process.stderr.write('jq: error: manifest is not valid JSON\n');
      return 2;
    }
    const response = callTransport(syncRequest(parsed, options));
    if (response.status !== 0) return response.status;
    const result = parseJson(response.stdout);
    if (!resultOk(result)) die('error', failureMessage(result, 'HQ sync failed'));
    const documentation = isRecord(result) ? result['documentation'] : undefined;
    const stats = isRecord(documentation) ? documentation['stats'] ?? null : null;
    process.stdout.write(syncSummary(parsed, stats, options.prune));

    const stateFile = syncStateFile();
    mkdirSync(path.dirname(stateFile), { recursive: true });
    const head = git(env.vault, ['rev-parse', 'HEAD']);
    const vaultHead = head.ok ? head.stdout.trim() : 'unknown';
    writeFileSync(stateFile, stateRecord(readFileSync(tmp), env.vault, 'mcp-default', vaultHead, new Date()));
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const doctor: Handler = (args, rt) => {
  if (args[0] !== undefined && args[0] !== '') return rt.dieUnknown('flag', args[0], 'doctor');
  const env = loadHqEnv();
  requireManifestMcp();
  const report = svmc(['hq-manifest', env.vault, '--report']);
  const text = report.ok ? report.stdout.replace(/\n+$/, '') : '';
  if (!text) die('error', `hq-manifest --report returned nothing; run \`${REINSTALL}\``);

  let rc = 0;
  try {
    const parsed = parseInput(text);
    const { text: out, code } = doctorReport(parsed);
    process.stdout.write(out);
    rc = code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    rc = 1;
  }

  const fresh = syncFreshness(env.vault);
  switch (fresh.kind) {
    case 'never':
      msg('yellow', 'sync', 'no recorded hq sync yet — run `hq sync`');
      break;
    case 'fresh':
      msg('green', 'sync', `HQ matches the vault manifest (last sync ${fresh.date})`);
      break;
    case 'stale':
      msg('yellow', 'sync', `doc metadata changed since the last sync (${fresh.date}) — run \`hq sync\``);
      rc = 1;
      break;
    case 'skip':
      break;
  }
  return rc;
};

function pipeToReport(request: unknown, render: (parsed: unknown) => string): number {
  const response = callTransport(request);
  let failure: unknown;
  try {
    process.stdout.write(render(parseInput(response.stdout)));
  } catch (error) {
    failure = error;
  }
  if (failure !== undefined) throw failure;
  return response.status;
}

export const validate: Handler = () => {
  loadHqEnv();
  msg('dim', 'validate', 'HQ registry ↔ vault docs');
  return pipeToReport({ tool: 'audit_registry', arguments: {} }, validateReport);
};

export const create: Handler = (args, rt: ToolRuntime) => {
  const kind = args[0] ?? '';
  if (kind === '') {
    rt.printUsage('create');
    return 0;
  }
  if (kind !== 'project' && kind !== 'asset') return rt.dieUnknown('kind', kind, 'create');
  const rest = args.slice(1);
  loadHqEnv();

  if (rest[0] === '-h' || rest[0] === '--help') {
    return pipeToReport({ tool: 'describe_capabilities', arguments: {} }, (catalog) => createHelp(catalog, kind));
  }

  const slug = rest[0];
  if (slug === undefined) return die('error', `missing <slug>; try \`hq create ${kind} -h\``);
  msg('dim', 'hq', `${kind}.upsert ${slug}`);
  const response = callTransport(createRequest([kind, ...rest]));
  if (response.status !== 0) return response.status;
  const result = parseJson(response.stdout);
  if (!resultOk(result)) die('error', failureMessage(result, 'HQ operation failed'));
  const created = isRecord(result) && result['created'] === true;
  msg('green', kind, `${slug}: ${created ? 'created' : 'updated'}`);
  return 0;
};

export const exportSummary: Handler = (args, rt) => {
  loadHqEnv();
  const year = args[0] || String(new Date().getFullYear());
  const format = args[1] || 'md';
  let ext: string;
  if (format === 'md' || format === 'markdown') ext = 'md';
  else if (format === 'json') ext = 'json';
  else return rt.dieUnknown('format', format, 'export');
  const yearValue = parseJson(year);
  if (yearValue === undefined) {
    process.stderr.write('jq: Invalid JSON text passed to --argjson\n');
    return 2;
  }
  const response = callTransport({ tool: 'export_year_summary', arguments: { year: yearValue, format: ext } });
  if (response.status !== 0) return response.status;
  const result = parseJson(response.stdout);
  if (!resultOk(result)) die('error', failureMessage(result, 'report export failed'));
  const record = isRecord(result) ? result : {};
  const out = jqText(record['filename']);
  writeFileSync(out, `${jqText(record['content'])}\n`);
  msg('green', 'wrote', out);
  process.stdout.write(`${out}\n`);
  return 0;
};

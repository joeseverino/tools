// hq/report.ts — the JSON shaping and plain-text reports behind `hq`: the
// create request, the sync summary and state record, the doctor and validate
// reports, and `hq create <kind> -h`.
//
// Usage: report.ts <command> [args...]; JSON arrives on stdin or as arguments.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { CliError, reportError } from '../sdk/cli.ts';
import { isRecord, isStringArray } from '../sdk/guards.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const [command = '', ...args] = process.argv.slice(2);

function stdin(): string {
  return readFileSync(0, 'utf8');
}

function fail(message: string, code = 2): never {
  throw new CliError(`hq: ${message}`, code);
}

function stdinJson(): unknown {
  try {
    return JSON.parse(stdin());
  } catch (error) {
    return fail(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

// ---- create ------------------------------------------------------------------

const ALIASES: Record<string, Record<string, string>> = {
  project: { technologies: 'technologies_used', repo: 'repository_url', url: 'public_url' },
  asset: {
    name: 'item_name',
    cost: 'total_cost',
    business_use: 'business_use_percentage',
    payment: 'payment_method',
    serial: 'serial_number',
  },
};

// The human `hq create` surface as one canonical MCP request.
function createRequest(argv: string[]): void {
  const [kind = '', slug, ...rest] = argv;
  const aliases = ALIASES[kind];
  if (!aliases || slug === undefined) fail('usage: hq create {project,asset} <slug> [--field value ...]');
  const payload: Record<string, string> = { slug };
  while (rest.length) {
    const flag = rest.shift() ?? '';
    if (flag === '--json') continue;
    if (!flag.startsWith('--') || !rest.length) fail(`expected --field value, got '${flag}'`);
    const key = flag.slice(2).replaceAll('-', '_');
    payload[aliases[key] ?? key] = rest.shift() ?? '';
  }
  process.stdout.write(`${JSON.stringify({ tool: 'execute_capability', arguments: { name: `${kind}.upsert`, payload } })}\n`);
}

// A JSON value as Python's repr would print it, which is how the field
// defaults have always been shown.
function pyRepr(value: Json): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
  return String(value);
}

interface FieldSpec { default?: Json; enum?: Json[]; format?: string; type?: string }
interface Capability {
  name: string;
  summary: string;
  input_schema: { required?: string[]; properties?: Record<string, FieldSpec> };
}

function isCapability(value: unknown): value is Capability {
  return isRecord(value)
    && typeof value['name'] === 'string'
    && typeof value['summary'] === 'string'
    && isRecord(value['input_schema']);
}

function createHelp(kind: string): void {
  const catalog = stdinJson();
  if (!isRecord(catalog) || !Array.isArray(catalog['capabilities']) || !catalog['capabilities'].every(isCapability)) {
    return fail('capability catalog has an unexpected shape', 1);
  }
  const capability = catalog['capabilities'].find((item) => item.name === `${kind}.upsert`);
  if (!capability) fail(`HQ does not advertise ${kind}.upsert`, 1);
  const schema = capability.input_schema;
  const required = new Set(schema.required ?? []);
  const lines = [`Usage: hq create ${kind} <slug> [--field value ...]`, '', capability.summary, '', 'Fields:'];
  for (const [field, spec] of Object.entries(schema.properties ?? {})) {
    if (field === 'slug') continue;
    const detail: string[] = [];
    if (required.has(field)) detail.push('required');
    if ('default' in spec && spec.default !== undefined) detail.push(`default: ${pyRepr(spec.default)}`);
    if (spec.enum?.length) detail.push(`one of: ${spec.enum.map(String).join(', ')}`);
    else if (spec.format) detail.push(spec.format);
    else if (spec.type) detail.push(spec.type);
    lines.push(`  ${`--${field.replaceAll('_', '-')}`.padEnd(28)} ${detail.join('; ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

// ---- sync ----------------------------------------------------------------------

interface SyncStats {
  created?: number;
  updated?: number;
  orphans_pruned?: number;
  content_items_synced?: number;
  content_items_pruned?: number;
  missing_relations?: number;
  missing_relations_detail?: { doc_id: string; kind: string; slug: string }[];
  orphans?: string[];
}

function isMissingRelation(value: unknown): boolean {
  return isRecord(value) && typeof value['doc_id'] === 'string' && typeof value['kind'] === 'string' && typeof value['slug'] === 'string';
}

function isSyncStats(value: unknown): value is SyncStats {
  return isRecord(value)
    && ['created', 'updated', 'orphans_pruned', 'content_items_synced', 'content_items_pruned', 'missing_relations']
      .every((key) => optionalNumber(value[key]))
    && (value['missing_relations_detail'] === undefined
      || (Array.isArray(value['missing_relations_detail']) && value['missing_relations_detail'].every(isMissingRelation)))
    && (value['orphans'] === undefined || isStringArray(value['orphans']));
}

function syncSummary(manifestPath: string, rawStats: string, pruneFlag: string): void {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest)) return fail('manifest is not a list', 1);
  const stats: unknown = JSON.parse(rawStats);
  if (!isSyncStats(stats)) return fail('sync stats have an unexpected shape', 1);
  const prune = pruneFlag === '1';
  const missing = stats.missing_relations ?? 0;
  const orphans = stats.orphans ?? [];
  const out = [`Docs      ${manifest.length} indexed`];
  const changes = [
    stats.created ? `${stats.created} created` : '',
    stats.updated ? `${stats.updated} updated` : '',
    stats.orphans_pruned ? `${stats.orphans_pruned} removed` : '',
  ].filter(Boolean);
  out.push(`Changes   ${changes.length ? changes.join(', ') : 'none'}`);
  if (missing) {
    out.push(`Relations ${missing} missing`);
    for (const item of (stats.missing_relations_detail ?? []).slice(0, 8)) {
      out.push(`          ${item.doc_id} → missing ${item.kind} ${item.slug}`);
    }
  } else {
    out.push('Relations ok');
  }
  const content = [
    stats.content_items_synced ? `${stats.content_items_synced} mirrored` : '',
    stats.content_items_pruned ? `${stats.content_items_pruned} stale removed` : '',
  ].filter(Boolean);
  out.push(`Content   ${content.length ? content.join(', ') : 'none'}`);
  if (orphans.length && prune) {
    out.push(`Cleanup   pruned ${orphans.length} orphan doc row(s)`);
  } else if (orphans.length) {
    out.push(`Cleanup   ${orphans.length} orphan doc row(s); run \`hq sync --prune\``);
    for (const docId of orphans.slice(0, 8)) out.push(`          ${docId}`);
  } else {
    out.push('Cleanup   no orphans');
  }
  out.push(missing || (orphans.length && !prune) ? 'Done      synced with cleanup needed' : 'Done      HQ is in sync');
  process.stdout.write(`${out.join('\n')}\n`);
}

// What shipped: the manifest's hash plus the exact inputs, so `vault status`
// and `hq doctor` can tell when HQ is stale.
function syncState(manifestPath: string, statePath: string, vault: string, dirs: string, head: string): void {
  const sha = createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
  const syncedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const state = { manifest_sha256: sha, vault, vault_dirs: dirs, vault_head: head, synced_at: syncedAt };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

// ---- doctor / validate -------------------------------------------------------

interface DoctorReport {
  count?: number;
  missing_frontmatter?: string[];
  duplicates?: { doc_id: string; first: string; second: string }[];
}

function isDuplicate(value: unknown): boolean {
  return isRecord(value) && typeof value['doc_id'] === 'string' && typeof value['first'] === 'string' && typeof value['second'] === 'string';
}

function isDoctorReport(value: unknown): value is DoctorReport {
  return isRecord(value)
    && optionalNumber(value['count'])
    && (value['missing_frontmatter'] === undefined || isStringArray(value['missing_frontmatter']))
    && (value['duplicates'] === undefined || (Array.isArray(value['duplicates']) && value['duplicates'].every(isDuplicate)));
}

function doctor(): void {
  const r = stdinJson();
  if (!isDoctorReport(r)) return fail('doctor report has an unexpected shape', 1);
  const missing = r.missing_frontmatter ?? [];
  const dups = r.duplicates ?? [];
  if (!missing.length && !dups.length) {
    process.stdout.write(`ok: ${r.count ?? 0} indexed docs have valid frontmatter\n`);
    return;
  }
  const out: string[] = [];
  if (dups.length) {
    out.push(`${dups.length} duplicate doc_id(s):`);
    for (const d of dups) out.push(`  - ${d.doc_id}: ${d.first}  <->  ${d.second}`);
  }
  if (missing.length) {
    out.push(`${missing.length} doc(s) missing or invalid frontmatter:`);
    for (const p of missing) out.push(`  - ${p}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
  process.exitCode = 1;
}

interface RegistryReport {
  projects_total: number;
  assets_total: number;
  orphan_projects: string[];
  orphan_assets: string[];
}

function isRegistryReport(value: unknown): value is RegistryReport {
  return isRecord(value)
    && typeof value['projects_total'] === 'number'
    && typeof value['assets_total'] === 'number'
    && isStringArray(value['orphan_projects'])
    && isStringArray(value['orphan_assets']);
}

function validate(): void {
  const r = stdinJson();
  if (!isRegistryReport(r)) return fail('registry report has an unexpected shape', 1);
  const out = [`Projects  ${r.projects_total} total, ${r.orphan_projects.length} with zero docs`];
  for (const slug of r.orphan_projects) out.push(`          orphan: ${slug}`);
  out.push(`Assets    ${r.assets_total} total, ${r.orphan_assets.length} with zero docs`);
  for (const slug of r.orphan_assets) out.push(`          orphan: ${slug}`);
  out.push(`Registry  ${r.orphan_projects.length || r.orphan_assets.length
    ? 'review orphans above — stale slug from a rename, or a duplicate row'
    : 'ok — every Project and Asset is referenced by at least one doc'}`);
  process.stdout.write(`${out.join('\n')}\n`);
}

try {
  switch (command) {
    case 'create-request': createRequest(args); break;
    case 'create-help': createHelp(args[0] ?? ''); break;
    case 'sync-summary': syncSummary(args[0] ?? '', args[1] ?? '{}', args[2] ?? '0'); break;
    case 'sync-state': syncState(args[0] ?? '', args[1] ?? '', args[2] ?? '', args[3] ?? '', args[4] ?? ''); break;
    case 'doctor': doctor(); break;
    case 'validate': validate(); break;
    default: fail(`unknown report: ${command}`);
  }
} catch (error) {
  reportError(error);
}

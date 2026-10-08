import type { CommandSpec, ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { call, create, doctor, drift, exportSummary, manifest, schema, sync, validate } from './data.ts';
import { loadHqEnv } from './env.ts';
import { envApply, envDiff, lifeSync, logs, open, restart, shell, ship, superuser } from './host.ts';

const commands: CommandSpec[] = [
  { name: 'manifest', summary: 'Print the manifest JSON (frontmatter from every doc) to stdout — for inspection or piping elsewhere', effect: 'read' },
  {
    name: 'sync',
    summary: 'Sync the docs manifest into HQ; idempotent and safe to re-run',
    effect: 'remote_write',
    network: true,
    options: [
      {
        flags: ['--prune'],
        help: 'Delete orphan DocumentationRecord rows (doc_ids in HQ but not in the manifest), plus ContentItems linked only to them. Use after a doc_id rename or retirement',
      },
      { flags: ['--no-update'], help: 'Only create new records; never update existing ones' },
    ],
  },
  { name: 'doctor', summary: "Report vault docs missing or with invalid frontmatter, and whether HQ's last-synced manifest is stale", effect: 'read' },
  {
    name: 'schema',
    summary: "Regenerate HQ's docs_index/schema.json from the installed MCP (the canonical frontmatter contract)",
    effect: 'local_write',
    options: [
      { flags: ['--check'], help: 'Verify the HQ schema.json and the vault schema doc match the MCP; exit 1 on drift without writing (CI / pre-deploy gate)' },
    ],
  },
  { name: 'validate', summary: 'Report HQ registry entries (Projects/Assets) that no vault doc references. Read-only', effect: 'read', network: true },
  {
    name: 'life-sync',
    summary: 'Emit the Life vault projection on this Mac and install it on HQ (renewals, goals, tasks, claims, vehicles)',
    effect: 'remote_write',
    network: true,
    paras: [
      'The Mac is the only machine that can read the vault, so the snapshot originates here. HQ reconciles by doc_id and prunes anything the document omits — so an empty or malformed snapshot is refused locally rather than sent, because sending it would delete the records it failed to mention.',
    ],
    examples: [{ command: 'hq life-sync', comment: "refresh HQ's Life records from the vault" }],
  },
  {
    name: 'create',
    summary: 'Create or update a Project or Asset in HQ (idempotent upsert by slug)',
    effect: 'remote_write',
    network: true,
    positionals: [
      { name: 'kind', choices: ['project', 'asset'], help: 'What to create' },
      { name: 'slug', help: 'Registry slug (the create_project / create_asset key)' },
    ],
    delegates: "HQ's schema-validated project.upsert / asset.upsert MCP capabilities; field names and defaults are owned by HQ",
    examples: [
      { command: 'hq create project my-site --name "My Site" --category cloudflare --status published --url https://example.com' },
      { command: 'hq create asset example-com --name "example.com" --category domain' },
    ],
  },
  {
    name: 'call',
    summary: "Call one HQ tool as the operator: the MCP tool contract, JSON arguments in, the tool's JSON result out",
    effect: 'remote_write',
    network: true,
    positionals: [
      { name: 'tool', help: 'HQ tool name (list them: hq call describe_capabilities)' },
      { name: 'arguments', optional: true, help: 'Tool arguments as one JSON object (default: {})' },
    ],
    paras: [
      "The same surface agents reach over MCP, reached over the host shell with the operator's own SSH certificate. A tool that writes is gated by HQ exactly as it is over MCP, including changes held for approval.",
    ],
    examples: [{ command: `hq call list_managed_resources '{"limit":20}'`, comment: 'what HQ manages' }],
  },
  {
    name: 'drift',
    summary: 'List managed resources HQ reports out of sync or unhealthy; exit 1 when any are',
    effect: 'read',
    network: true,
    options: [{ flags: ['--json'], help: 'Print the drifted resources as JSON' }],
    paras: ['HQ reconciles what it declares against what each provider reports. This reads that verdict; it never reads a provider itself.'],
  },
  {
    name: 'ship',
    summary: 'Commit + push a small HQ change. The push IS the deploy: it triggers the gated pipeline (build → scan → deploy on green)',
    effect: 'deploy',
    network: true,
    options: [{ flags: ['-m', '--message'], metavar: 'TEXT', help: 'Commit message for the HQ repo change (required)' }],
  },
  {
    name: 'env-diff',
    summary: "Key-level drift between the 1Password 'severino-hq env' item (the source of truth) and the env rendered on prod. Key names only — values never print",
    effect: 'read',
    network: true,
  },
  {
    name: 'env-apply',
    summary: 'Apply 1Password env changes to prod now: runs severino-hq-secrets.service (renders + restarts only if something changed; the hourly timer does this anyway)',
    effect: 'deploy',
    network: true,
  },
  {
    name: 'logs',
    summary: 'Show app container logs (default tail 50)',
    effect: 'read',
    network: true,
    options: [
      { flags: ['-f', '--follow'], help: 'Stream live output until Ctrl-C' },
      { flags: ['--tail'], metavar: 'N', help: 'Number of lines to show (default 50; ignored with --follow)' },
    ],
  },
  {
    name: 'restart',
    summary: '`docker compose restart app` — no rebuild, no migrations. For stuck state (env changes need env-push: restart does not re-read .env)',
    effect: 'deploy',
    network: true,
  },
  { name: 'open', summary: 'Open $HQ_URL in the browser', effect: 'read' },
  { name: 'shell', summary: 'ssh -t into the HQ Django shell (poke the ORM)', effect: 'remote_write', network: true, interactive: true },
  { name: 'superuser', summary: 'ssh -t into HQ and run createsuperuser interactively', effect: 'remote_write', network: true, interactive: true },
  {
    name: 'export',
    summary: 'Download the year summary to ./ and print the path',
    effect: 'local_write',
    network: true,
    positionals: [
      { name: 'year', optional: true, help: 'Year to export (default: current year)' },
      { name: 'format', optional: true, choices: ['md', 'json'], help: 'Output format (default: md)' },
    ],
  },
];

export const spec: ToolSpec = {
  name: 'hq',
  description: 'Sync vault frontmatter to Severino HQ, plus routine HQ operational commands.',
  group: 'Integrations',
  order: 130,
  effect: 'read',
  synopsis: ['hq <command> [args]'],
  paras: [
    'Severino HQ glue. Reads YAML frontmatter from the vault and upserts the HQ docs index. Also wraps the routine ssh + docker compose calls for inspecting the HQ deployment. It does not deploy: landing on main is the deploy.',
  ],
  examples: [
    { command: 'hq sync', comment: 'most common — push vault → HQ' },
    { command: "hq manifest | jq '.[] | .doc_id'" },
    { command: 'hq doctor', comment: 'find docs missing frontmatter' },
    { command: 'hq export 2026', comment: 'download year-summary-2026.md' },
  ],
  commands,
  env: [
    { name: 'NOTES_HOME', help: 'Vault root' },
    { name: 'HQ_SSH_HOST', help: 'SSH alias of the HQ server' },
    { name: 'HQ_REMOTE_PATH', help: 'HQ checkout path on the server' },
    { name: 'HQ_LOCAL_PATH', help: 'Local HQ checkout' },
    { name: 'HQ_URL', help: 'Public URL of HQ' },
    { name: 'HQ_CALL', help: "Operator transport to HQ's tools (default: lib/hq-call over HQ_SSH_HOST)" },
    { name: 'HQ_CONTAINER', help: 'HQ container on HQ_SSH_HOST (default: severino-hq)' },
  ],
};

// Config is sourced before any command runs, so a missing layout variable stops
// every command alike.
function configured(handler: Handler): Handler {
  return (args, rt) => {
    loadHqEnv();
    return handler(args, rt);
  };
}

export const tool: ToolDefinition = {
  spec,
  commands: {
    manifest: configured(manifest),
    sync: configured(sync),
    doctor: configured(doctor),
    schema: configured(schema),
    validate: configured(validate),
    'life-sync': configured(lifeSync),
    create: configured(create),
    call: configured(call),
    drift: configured(drift),
    ship: configured(ship),
    'env-diff': configured(envDiff),
    'env-apply': configured(envApply),
    logs: configured(logs),
    restart: configured(restart),
    open: configured(open),
    shell: configured(shell),
    superuser: configured(superuser),
    export: configured(exportSummary),
  },
  fallback: (args, rt) => {
    loadHqEnv();
    return rt.dieUnknown('command', args[0] ?? '');
  },
};

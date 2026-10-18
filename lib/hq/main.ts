import type { CommandSpec, ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { call, create, doctor, manifest, schema, sync, validate } from './data.ts';
import { loadHqEnv } from './env.ts';

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
    examples: [
      { command: 'hq call describe_resources', comment: "what HQ can list, and each list's filters" },
      { command: `hq call list_resource '{"name":"infrastructure.resources","filters":{"limit":20}}'`, comment: 'what HQ manages' },
      { command: 'hq call get_findings', comment: 'what HQ claims is wrong, with remedies' },
    ],
  },
];

export const spec: ToolSpec = {
  name: 'hq',
  description: 'Sync vault frontmatter to Severino HQ, and call HQ as the operator.',
  group: 'Integrations',
  order: 130,
  effect: 'read',
  synopsis: ['hq <command> [args]'],
  paras: [
    "Severino HQ glue. Reads YAML frontmatter from the vault and upserts the HQ docs index, and reaches HQ's tools as the operator through manage.py hq_call on the HQ host over ssh. It runs nothing on the host but HQ's own tools.",
  ],
  examples: [
    { command: 'hq sync', comment: 'most common — push vault → HQ' },
    { command: "hq manifest | jq '.[] | .doc_id'" },
    { command: 'hq doctor', comment: 'find docs missing frontmatter' },
    { command: 'hq call get_findings', comment: 'what HQ claims is wrong, with remedies' },
  ],
  commands,
  env: [
    { name: 'NOTES_HOME', help: 'Vault root' },
    { name: 'HQ_SSH_HOST', help: 'SSH alias of the HQ server' },
    { name: 'HQ_LOCAL_PATH', help: 'Local HQ checkout' },
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
    create: configured(create),
    call: configured(call),
  },
  fallback: (args, rt) => {
    loadHqEnv();
    return rt.dieUnknown('command', args[0] ?? '');
  },
};

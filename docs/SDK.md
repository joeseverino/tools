# Severino Tools SDK

The Tools repository is both the operator's CLI suite and a lightweight runtime
for sibling repositories, one-off scripts, and agent-generated utilities. The
SDK standardizes mechanics; it never owns domain vocabulary.

## Layers

```text
schemas/                 language-neutral contracts
lib/sdk/surface.ts       typed tool spec, Cordon contract rendering
lib/sdk/usage.ts         help screens rendered from a spec
lib/sdk/tool.ts          runTool: help/--describe interception, deploy gate, dispatch
lib/sdk/cli.ts           CliError, die, exit-code mapping, reportError
lib/sdk/output.ts        status lines, header/footer, byte-padded label columns
lib/sdk/color.ts         terminal colour through util.styleText (off when not a TTY or NO_COLOR is set)
lib/sdk/process.ts       argument-safe sync/async process execution, JSON with a validate guard
lib/sdk/guards.ts        isRecord, isStringArray, parseJson: JSON boundaries stay `unknown` until checked
lib/sdk/paths.ts         CODE_HOME and TOOLS_HOME, derived once
lib/sdk/config.ts        config/<name>.sh read through bash (local file, else .example)
lib/sdk/svmc.ts          governed vault CLI crossing
lib/sdk/result.ts        result-v1 envelope
lib/sdk/ci.ts            the CI-equivalent environment
lib/sdk/which.ts         command -v
lib/sdk/report.ts        named checks and gates for health reports
lib/sdk/spec-cli.ts      renderer behind the shell authoring DSL
lib/sdk/{core,svmc,ci}.sh, lib/sdk.sh, lib/describe.sh   shell twins for shell consumers
config/capabilities.json fleet capability declarations
config/contracts.json    producer → consumer contract graph
```

New consumers import the narrowest module they need. `lib/common.sh` aggregates
the shell twins for the bats harness.

## A typed tool

```ts
// lib/inspect-widget/main.ts
import { resultOk } from '../sdk/result.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: 'inspect-widget',
  description: 'Inspect one widget.',
  group: 'Other',
  order: 900,
  effect: 'read',
  synopsis: ['inspect-widget <id>'],
  positionals: [{ name: 'id', help: 'Widget identifier' }],
};

const run: Handler = (args) => {
  process.stdout.write(resultOk({ id: args[0] ?? '' }));
  return 0;
};

export const tool: ToolDefinition = { spec, run };
```

```text
#!/usr/bin/env node
import { runTool } from "../lib/sdk/tool.ts";
import { tool } from "../lib/inspect-widget/main.ts";
await runTool(tool);
```

`tools new <name> --agent` scaffolds this shape. A tool with subcommands lists
them in `spec.commands` and supplies `commands: { name: handler }`; `runTool`
refuses to start when the two sets differ. The handler emits
`schemas/result-v1.json`, so agents receive stable success, failure, warning,
receipt, and next-action fields without every script inventing an envelope.

## Node utility

```ts
import { runJson } from './lib/sdk/process.ts';
import { isRecord } from './lib/sdk/guards.ts';

const result = runJson('some-command', ['--json'], {}, isRecord);
if (!result.ok || !result.json) process.exitCode = 1;
```

`runJson` and `spawnJson` take an optional guard as the last argument. A
guard that rejects the parsed value turns the result into a failure, so callers
read typed JSON without a cast.

Helpers keep `process.exit` out of the way: they throw `CliError` (or call
`die` / `usageError`), and `runTool` reports it, setting `process.exitCode`.
`util.parseArgs` rejections map to exit code 2, and `parsing(rt, ...)` turns an
unknown flag into the shared usage error that prints the valid surface.

## Shell utility

```bash
#!/usr/bin/env bash
set -euo pipefail
source "${TOOLS_HOME:?}/lib/sdk.sh"

describe_spec() {
    desc_tool "inspect-widget" "Inspect one widget."
    desc_inventory "Other" 900
    desc_synopsis "inspect-widget <id>"
    desc_effect read
    desc_pos id -- "Widget identifier"
}

desc_help_intercept "$@"
result_ok "{\"id\":\"$(json_escape "$1")\"}"
```

The `desc_*` calls only collect records; `lib/sdk/spec-cli.ts` renders them
through the same code as the typed tools. Vault governance goes through
`lib/sdk/svmc.ts` (or `svmc.sh` from shell), which owns binary selection and
vault-path propagation.

The SDK holds no credentials. Anything that needs one goes to the system that
owns it: HQ through `hq call`, a secret through 1Password at the point of use.

## Capability registry

`config/capabilities.json` declares repository capabilities once: describe and
brief emitters, engine consumers, install commands, and schema surfaces.
`lib/tools/capabilities.ts` derives federation and fleet operations from it.
Repository discovery (`repos --json`) remains the owner of actual on-disk fleet
state; the manifest declares capabilities, not inventory.

Add a field only when two consumers need it. Validate every manifest change
against `schemas/capabilities-v1.json`; a wire-format change requires a new
versioned schema.

## Contract graph

`config/contracts.json` declares each domain contract once, names its owner,
and connects it to derived consumer projections. A projection provides its
owner's check command and, when available, repair command; Tools only executes
and reports those surfaces. It does not reproduce the domain comparison.

`tools contracts` renders the graph with a SHA-256 fingerprint of every
available source. `tools contracts --check` runs declared projection checks
and fails on drift. Projection scopes form a strict `local → fleet → live`
ladder: CI selects `local`, `tools doctor --all` selects `fleet`, and
`tools doctor --live` opts into live systems. Repository paths and emitter
commands resolve through the capability registry, so the graph never becomes
another fleet inventory or command catalog.

Pass a contract or projection id to return only that dependency slice. This is
the token-minimal impact path for operators and agents: the owner, source
fingerprint, affected consumers, checks, and repairs without the full graph.

The graph is validated against `schemas/contract-graph-v1.json`. Add an edge
when a real consumer projection exists; do not register aspirational
dependencies or checks that duplicate an owner's business rules.

`tools derive <projection>` renders the owner-declared repair as a dry-run;
`--go` executes it and immediately re-runs the projection check. `--all` is
required for batches. Generic repairs are schema-limited to `local_write`, so
remote mutations and deployments remain in their explicit governed workflows.

## Boundaries

- Cordon describes commands and effects.
- result-v1 describes generic execution outcomes.
- vault-engine owns vault governance mechanics, plans, and mutation receipts.
- domain repositories own their vocabulary and business rules.
- Tools SDK owns CLI/process/output composition only.

Avoid a general plugin framework, hidden dependency injection, or importing the
entire Tools suite for one helper. Small explicit modules are the scalability
mechanism.

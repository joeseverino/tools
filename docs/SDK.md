# Severino Tools SDK

The Tools repository is both the operator's CLI suite and a lightweight runtime
for sibling repositories, one-off scripts, and agent-generated utilities. The
SDK standardizes mechanics; it never owns domain vocabulary.

## Layers

```text
schemas/                 language-neutral contracts
lib/sdk/core.sh          shell output, errors, JSON scalars, result envelopes
lib/sdk.sh               shell command runtime (core + Cordon emitter)
lib/sdk/process.mjs      argument-safe sync/async process execution
lib/sdk/result.mjs       result-v1 constructors and rendering
lib/sdk/svmc.{sh,mjs}    governed vault CLI crossing
lib/sdk/secrets.sh       logical secret ids, schema validation, provider crossing
config/capabilities.json fleet capability declarations
```

`lib/common.sh` remains a compatibility aggregator for the existing suite. New
consumers import the narrowest module they need.

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

`tools new <name> --agent` scaffolds this shape. The handler emits
`schemas/result-v1.json`, so agents receive stable success, failure, warning,
receipt, and next-action fields without every script inventing an envelope.

## Node utility

```js
import { runJson } from './lib/sdk/process.mjs';
import { success, failure, writeResult } from './lib/sdk/result.mjs';

const result = runJson('some-command', ['--json']);
writeResult(result.ok ? success(result.json) : failure('command_failed', result.error));
```

Use `svmc(args)` from `lib/sdk/svmc.mjs` for vault governance. It owns binary
selection, vault-path propagation, argument-safe execution, JSON parsing, and
the MCP `{ok,error}` convention.

Shell consumers use `secret_read <logical-id>` from `lib/sdk/secrets.sh`; the
versioned `schemas/secrets-v1.json` contract validates the registry before any
provider call. Callers never know a vault name, item name, or provider URI.

## Capability registry

`config/capabilities.json` declares repository capabilities once: describe and
brief emitters, engine consumers, install commands, and schema surfaces.
`lib/tools/capabilities.mjs` derives federation and fleet operations from it.
Repository discovery (`repos --json`) remains the owner of actual on-disk fleet
state; the manifest declares capabilities, not inventory.

Add a field only when two consumers need it. Validate every manifest change
against `schemas/capabilities-v1.json`; a wire-format change requires a new
versioned schema.

## Boundaries

- Cordon describes commands and effects.
- result-v1 describes generic execution outcomes.
- vault-engine owns vault governance mechanics, plans, and mutation receipts.
- domain repositories own their vocabulary and business rules.
- Tools SDK owns CLI/process/output composition only.

Avoid a general plugin framework, hidden dependency injection, or importing the
entire Tools suite for one helper. Small explicit modules are the scalability
mechanism.

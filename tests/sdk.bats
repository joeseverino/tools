#!/usr/bin/env bats
# Reusable SDK contracts, narrow imports, process helpers, and capability registry.

load helpers

@test "shell SDK emits valid success and failure result envelopes" {
    run bash -c 'source "$TOOLS_HOME/lib/sdk/core.sh"; result_ok '\''{"value":1}'\'' \
      | node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/result-v1.json"'
    [ "$status" -eq 0 ]
    [[ "$output" == *"valid: result-v1.json"* ]]

    run bash -c 'source "$TOOLS_HOME/lib/sdk/core.sh"; result_ok '\''{"value":1}'\'' '\''["partial sync"]'\'' \
      | node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/result-v1.json"'
    [ "$status" -eq 0 ]

    run bash -c 'source "$TOOLS_HOME/lib/sdk/core.sh"; result_error stale_plan "reload" 1 \
      | node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/result-v1.json"'
    [ "$status" -eq 0 ]
}

@test "Node result SDK emits envelopes valid against the same schema" {
    run bash -c 'node --input-type=module -e '\''
      import { success, writeResult } from "./lib/sdk/result.mjs";
      writeResult(success({ value: 1 }, { warnings: ["partial sync"] }));
    '\'' | node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/result-v1.json"'
    [ "$status" -eq 0 ]

    run bash -c 'node --input-type=module -e '\''
      import { failure, writeResult } from "./lib/sdk/result.mjs";
      writeResult(failure("stale_plan", "reload", { retryable: true }));
    '\'' | node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/result-v1.json"'
    [ "$status" -eq 0 ]
}

@test "die_unknown degrades cleanly without the describe runtime" {
    run bash -c 'source "$TOOLS_HOME/lib/sdk/core.sh"; die_unknown flag --nope'
    [ "$status" -eq 2 ]
    [[ "$output" == *"unknown flag: --nope"* ]]
    [[ "$output" != *"command not found"* ]]
}

@test "header takes an optional noun and pluralizes it" {
    run bash -c 'source "$TOOLS_HOME/lib/sdk/core.sh"; header syncing 2 repo'
    [ "$status" -eq 0 ]
    [[ "$output" == *"syncing 2 repos"* ]]

    run bash -c 'source "$TOOLS_HOME/lib/sdk/core.sh"; header archiving 1'
    [ "$status" -eq 0 ]
    [[ "$output" == *"archiving 1 file"* ]]
}

@test "Node process SDK parses JSON and reports invalid JSON" {
    run node --input-type=module -e '
      import { runJson } from "./lib/sdk/process.mjs";
      const good = runJson(process.execPath, ["-e", "console.log(JSON.stringify({ok:true}))"]);
      const bad = runJson(process.execPath, ["-e", "console.log(\"nope\")"]);
      if (!good.ok || !good.json.ok || bad.ok || !bad.error.includes("invalid JSON")) process.exit(1);
    '
    [ "$status" -eq 0 ]
}

@test "capability manifest validates and derives engine consumers with env seams" {
    run bash -c 'node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/capabilities-v1.json" \
      < "$TOOLS_HOME/config/capabilities.json"'
    [ "$status" -eq 0 ]

    MCP_HOME="$BATS_TEST_TMPDIR/mcp" EDU_MCP_HOME="$BATS_TEST_TMPDIR/edu" \
      LIFE_MCP_HOME="$BATS_TEST_TMPDIR/life" \
      run node "$TOOLS_HOME/lib/tools/capabilities.mjs" paths engine_consumer
    [ "$status" -eq 0 ]
    [ "$output" = "$BATS_TEST_TMPDIR/mcp
$BATS_TEST_TMPDIR/edu
$BATS_TEST_TMPDIR/life" ]

    MCP_HOME="$BATS_TEST_TMPDIR/mcp" run node --input-type=module -e '
      import { repositoryEntries } from "./lib/tools/capabilities.mjs";
      const mcp = repositoryEntries().find((entry) => entry.id === "severino-vault-mcp");
      if (mcp.path !== process.env.MCP_HOME) process.exit(1);
    '
    [ "$status" -eq 0 ]
}

@test "contract graph validates, fingerprints owners, and checks declared projections" {
    run bash -c 'node "$TOOLS_HOME/lib/tools/validate-json.mjs" "$TOOLS_HOME/schemas/contract-graph-v1.json" \
      < "$TOOLS_HOME/config/contracts.json"'
    [ "$status" -eq 0 ]

    run "$TOOLS_HOME/bin/tools" contracts --check --scope local --json
    [ "$status" -eq 0 ]
    node -e '
      const graph = JSON.parse(process.argv[1]);
      if (graph.contract_graph_version !== 1 || graph.contracts.length < 2) process.exit(1);
      if (!graph.contracts.filter((item) => item.id !== "vault.frontmatter.v1").every((item) => item.fingerprint.available)) process.exit(1);
      if (!graph.contracts.find((item) => item.id === "vault.frontmatter.v1").fingerprint.skipped) process.exit(1);
      if (!graph.projections.some((item) => item.contract === "tools.command-inventory.v4")) process.exit(1);
      if (!graph.projections.every((item) => item.ok)) process.exit(1);
      if (graph.projections.some((item) => item.scope !== "local")) process.exit(1);
    ' "$output"

    run node --input-type=module -e '
      import fs from "node:fs";
      import { repositoryCapability } from "./lib/tools/capabilities.mjs";
      const graph = JSON.parse(fs.readFileSync("config/contracts.json"));
      const edge = graph.projections.find((item) => item.id === "hq.frontmatter-schema");
      const source = graph.contracts.find((item) => item.id === edge.contract).source;
      if (edge.scope !== "fleet" || !edge.repair) process.exit(1);
      if (repositoryCapability(source.repository, source.capability).join(" ") !== "severino-vault-mcp schema --contract") process.exit(1);
    '
    [ "$status" -eq 0 ]
}

@test "derive is dry-run by default and verifies an owner-declared repair" {
    local repo="$BATS_TEST_TMPDIR/consumer"
    local graph="$BATS_TEST_TMPDIR/contracts.json"
    mkdir -p "$repo"
    cat > "$graph" <<'JSON'
{"contract_graph_version":1,"contracts":[{"id":"fixture.v1","owner":"fixture","description":"Fixture contract.","source":{"repository":"severino-vault-mcp","path":"source.json"}}],"projections":[{"id":"fixture.output","contract":"fixture.v1","consumer":"fixture","description":"Fixture projection.","scope":"local","check":{"repository":"severino-vault-mcp","argv":["test","-f","derived.txt"]},"repair":{"repository":"severino-vault-mcp","argv":["touch","derived.txt"],"effect":"local_write"}}]}
JSON

    TOOLS_CONTRACT_GRAPH="$graph" MCP_HOME="$repo" run "$TOOLS_HOME/bin/tools" derive fixture.output --json
    [ "$status" -eq 0 ]
    [ ! -e "$repo/derived.txt" ]
    [[ "$output" == *'"status":"planned"'* ]]

    TOOLS_CONTRACT_GRAPH="$graph" MCP_HOME="$repo" run "$TOOLS_HOME/bin/tools" derive fixture.output --go --json
    [ "$status" -eq 0 ]
    [ -e "$repo/derived.txt" ]
    [[ "$output" == *'"status":"derived"'* ]]
}

@test "common remains a compatibility aggregator over narrow SDK modules" {
    run bash -c 'source "$TOOLS_HOME/lib/common.sh"; type result_ok; type svmc; type vault_tree; type ci_shell_env; type hq_sync_freshness'
    [ "$status" -eq 0 ]
}

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
}

@test "common remains a compatibility aggregator over narrow SDK modules" {
    run bash -c 'source "$TOOLS_HOME/lib/common.sh"; type result_ok; type svmc; type vault_tree; type ci_shell_env; type hq_sync_freshness'
    [ "$status" -eq 0 ]
}

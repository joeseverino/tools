# shellcheck shell=bash
# engine.sh — the vault-engine consumer fleet seam.
#
# severino-vault-engine is the shared core behind every vault server and
# CLI in the fleet; the invariant is that every consumer's uv.lock pins the
# SAME engine commit, so a schema/core change can never reach one consumer
# and not the others silently. `tools bump-engine` moves the fleet together;
# the "engine lock parity" check in `tools doctor` gates the invariant. Both
# read the consumer list and the lock pin from here — one definition, two
# faces.

# engine_consumers — print the consumer repo paths, one per line. Per-repo
# env seams (MCP_HOME matches bin/site's; EDU_MCP_HOME / LIFE_MCP_HOME are
# this file's) let the bats suite point at fixtures, else the sibling
# checkouts resolve.
engine_consumers() {
    node "$TOOLS_HOME/lib/tools/capabilities.mjs" paths engine_consumer
}

# engine_lock_pin <repo> — print "<version> @<sha12>" for the locked
# severino-vault-engine in <repo>/uv.lock (just "<version>" for a non-git
# source, empty when the file or package block is missing). The uv.lock
# block shape is name → version → source; the parse keys on that.
engine_lock_pin() {
    [[ -f "$1/uv.lock" ]] || return 0
    awk -F'"' '
        /^name = /    { pkg = $2 }
        pkg == "severino-vault-engine" && /^version = / { ver = $2 }
        pkg == "severino-vault-engine" && /^source = /  {
            src = $2
            if (sub(/^[^#]*#/, "", src)) { print ver " @" substr(src, 1, 12) } else { print ver }
            exit
        }
    ' "$1/uv.lock"
}

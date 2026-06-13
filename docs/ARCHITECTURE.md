# Architecture

The personal CLI toolchain: small bash/zsh/node tools that share one look and
feel, one help/JSON contract, and one set of drift guards. This doc is the map;
[`command-surface-contract.md`](command-surface-contract.md) is the deep dive on
the contract that ties them together. House rules for editing live in
[`../AGENTS.md`](../AGENTS.md).

## Layout

| Dir | What |
|---|---|
| `bin/` | Exactly one executable per tool, nothing else. `tools install`, `tools describe`, `tools doctor`, and CI discover tools by globbing `bin/*`. |
| `lib/` | Shared helpers flat (`common.sh`, `init.sh`, `key.sh`, `describe.sh`, `drift.sh`, `doctor.sh`, `tui.mjs`); tool-specific support under `lib/<tool>/`. |
| `config/` | Per-tool defaults from layout env vars. `*.example` are templates; their gitignored copies are user-specific. |
| `schemas/` | Machine-enforced cross-tool contracts. Runtime verification inputs, not prose documentation. |
| `tests/` | Hermetic bats suite — throwaway keys, tmpdirs, no Keychain. |
| `bench/` | Every measured README claim has a script here; they run in CI. |
| `docs/` | This map, the contract deep-dive, and `docs/diagrams/` (mermaid sources + rendered PNGs). |

## The emit-once command surface

Every tool declares its command surface **once**, in a `describe_spec()` function
(the `desc_*` DSL in `lib/describe.sh`). From that single declaration, one engine
renders every view — the human `-h` screens, the `--describe` JSON contract, the
`--tui` explorer, and the federated `tools describe` document. No tool
hand-writes help; no prose is parsed, so the human help and the machine JSON
cannot drift.

![emit-once, render-many](diagrams/emit-once.png)

This is the spine of the repo. A new tool becomes self-helping and
self-describing the moment it defines `describe_spec` and puts
`desc_help_intercept "$@"` above its dispatch `case`. The `case` after it is the
only thing not derivable from the spec — pure command→action wiring — and
`describe.bats` guards that the two sets can't drift.

**The docs are derived too — by the same host.** The README CLI
reference/inventory and the zsh completion file are not hand-written: `tools
generate` is another render-many consumer that regenerates both from the same
federated JSON. The same emitter that answers `-h` writes the documentation, so
the prose a human reads, the completions a shell offers, and the JSON an agent
parses are three views of one declaration and cannot drift. `tools check`
validates every emitter against `schemas/describe-v4.schema.json` and fails when
either generated artifact is stale. Generation fails closed if any tool did not
emit a valid contract; it never silently drops a broken tool from the generated
surfaces.

The v4 contract also carries required, globally ordered inventory metadata.
README, completions, and the TUI consume that one order; schema validation
rejects missing metadata and duplicate positions. Every command also carries an
**effect** — a blast-radius class an agent risk-gates on before running. See
[`command-surface-contract.md`](command-surface-contract.md).

## Safe AI tooling — the contract drives *and* guards the agent

The same JSON that feeds the README and completions is what makes this toolchain
safe for an AI to operate. An agent doesn't guess what a tool does or read its
handler — it fetches the scope it is about to act on (`tools describe <tool>
<command>`, or the MCP's `describe_commands` tool) and gets back the command's
flags, args, examples, **and its `effect`**. The effect is the one fact an agent
cannot infer from the flags: a blast-radius class (`read` → `local_write` →
`vault_write` → `remote_write` → `deploy`) plus `+network` / `+interactive` tags.
That single signal lets the agent risk-gate before it runs anything — a `read`
runs freely; a `deploy` or a `remote_write` gets a confirmation or a dry-run
first. `severino-vault-mcp` is on both ends of this loop: it is a *sibling
emitter* folded into the federated document, **and** the channel through which an
AI session reads the contract and inherits the safeguards. The contract is what
turns "an agent with shell access" into "an agent that knows the blast radius of
every command before it pulls the trigger." See
[`command-surface-contract.md`](command-surface-contract.md) for the effect
model and the scoped-lookup AI path.

## Drift-guard family

`ts-acl`, `cf-dns`, `adguard`, and `nginx` are one tool wearing four hats:
`lib/drift.sh` is the shared core (`drift_main`), and each guard supplies only
`get_token` / `fetch_live` / `normalize` + config. They expose the same
`show` / `diff` / `pull` surface (declared once in `drift_describe_commands`, so
all four inherit it — including their effects). A `pull` writes the live state
back into a section-scoped mirror block in the Obsidian vault through the MCP's
`update-mirror-block` (one atomic write that also stamps `last_reviewed`), with a
scoped awk rewrite as the offline fallback.

## The MCP boundary

We own `severino-vault-mcp` but call it as a plain, schema-validated CLI — never
hand-editing vault frontmatter or shelling out to `yq`. In `bin/site` every call
goes through the `svmc()` wrapper (which sets `SVMC_VAULT_PATH`); elsewhere it is
`SVMC_VAULT_PATH="$NOTES_HOME" severino-vault-mcp …`. The MCP is the one
canonical writer and the one canonical frontmatter schema (`hq schema`
regenerates HQ's copy from it). It emits the **same `describe` contract** this
repo defines (a subset + the shared `schema_version` and `effect`), so
`tools describe --repos` folds it into one federated document.

## Verification

`tools check` runs everything CI runs: shebang-driven `bash -n` / `zsh -n` /
`node --check`, shellcheck, the bats suite, and the bench assertions
(`--no-bench` skips the slow step). `tools doctor --all` is the cross-system
rollup (hq doctor, hq schema --check, site doctor); `--live` adds the drift
guards (network + age key). `tools status --json` / `tools doctor --json` give
machine-readable state.

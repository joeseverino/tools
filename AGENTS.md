# AGENTS.md — house rules for this repo

Canonical agent guide for the personal CLI toolchain. `CLAUDE.md` is a symlink
to this file, so Claude Code and any AGENTS.md-aware tool read the same source.
Read this before editing; it answers the questions agents otherwise re-derive
from the code every session.

Small bash/zsh/node tools that share one look and feel.

## Command-surface contract (`describe`)

Every tool emits its command surface as one structured JSON document conforming
to [**Cordon**](https://github.com/joeseverino/cordon) — the language-agnostic
command-surface contract (the framework, schema, and emitter guide live there;
read it first). This section is the rules for *this repo's* Bash implementation
of it — the `desc_*` DSL and its renderers; the prose walkthrough is
[`docs/command-surface-contract.md`](docs/command-surface-contract.md). (Vault
decision record: `read_doc('report-emit-once-render-many')`; the Python sibling
emitter is `severino-vault-mcp`'s `cli_introspect.describe_parser`.)

- **One source, one dispatch line — leaf and subcommand alike.** A tool defines
  a single `describe_spec()` (the `desc_*` DSL in `lib/describe.sh`) and calls
  **`desc_help_intercept "$@"`** first in its dispatch. That one line renders the
  whole help + machine surface from the spec, and **derives the rest from the
  spec's shape** (does it declare any `desc_cmd`?) so a tool never restates it:
  `-h`/`--help` → the git-style main screen (`usage()`); `--describe` → the JSON
  — both universal. For a **subcommand tool** it also serves bare/`help` → main
  screen and **`<tool> <cmd> -h` → that command's focused screen**
  (`usage_command`); for a **leaf tool** (no `desc_cmd`) it claims only the
  unambiguous `-h`/`--help`/`--describe` meta-flags and hands back, because a
  leaf's bare / `help` invocation is the tool's own to define (`backup` runs,
  `encrypt` errors with its usage). So a leaf tool with its own options
  (`encrypt`, `decrypt`, `inbox`, `remember`, `backup`, `open-age`) drops the
  hand-rolled `--describe)` / `-h)` arms and uses the same one line; adding or
  removing a `desc_cmd` re-routes dispatch with no second edit. No tool
  hand-routes help, and a help flag can never fall through to run an action
  (`hq restart -h`, `adguard pull -h`, `site doctor -h` all *render*, never
  execute). The `case` after it is pure command→action wiring — the only thing
  not derivable from the spec (`cmd_*` vs `run_npm` vs aliases); `describe.bats`
  guards that every declared command has a dispatch arm so the two sets can't
  drift. New tools get this form from `tools new`. (Lone exception: the zsh
  `dns-test` self-describes via `getopts` + a `--describe`/`--help` preflight,
  since `getopts` can't see long options.)
- **Everything per-command is spec-derived — zero hand-written sub-help, zero
  help heredocs in the toolchain.** After a `desc_cmd`, declare its flags
  (`desc_opt`/`desc_pos`), prose (`desc_para`), and examples (`desc_example`);
  all are **scoped to that command**, so the focused `-h`, JSON, and `--tui`
  light up from the one declaration. `desc_pos … "{a,b,c}"` gives a positional
  a fixed choice set; `+variadic` rides into JSON for completion consumers.
  Keep the data model honest: structured → structured primitives
  (flags`→desc_opt`, args`→desc_pos`, examples`→desc_example`), `desc_para` for
  genuine prose only; interactive UIs (the `site manage` / compare viewers)
  self-document their keymaps rather than restating them in CLI help.
  **A `desc_para` call is ONE logical paragraph — a single unwrapped string, not
  a hard-wrapped source line.** Every renderer (`-h`, the README, the `--tui`
  expand pane) reflows it to its own width, so presentation line-breaks must
  never be baked into the source of truth; declare multiple `desc_para`s for
  multiple paragraphs (the renderers space them), never an empty `desc_para ""`
  separator. The validator fails closed on a paragraph that ends mid-sentence or
  is empty (`lib/tools/describe-schema.mjs`, guarded by `describe.bats`).
- **Flags owned by another repo are pointed at, never restated.** `hq create`'s
  flags live in HQ's `manage.py`, and site's `scaffold-*`/`draft-alt`/`diagnose`
  flags live in the site repo's `package.json` scripts. Those commands declare
  **`desc_delegate "<owner>"`** (after the `desc_cmd`) instead of enumerating
  flags — a *structured* ownership marker that renders in the focused `-h`
  ("Flags are owned elsewhere: …") **and** rides into the JSON as `delegates`, so
  an agent sees ownership without reading handlers. `hq create <kind> -h` also
  falls through to `manage.py` (the help flag isn't the *2nd* arg, so the
  intercept skips it) — the owner renders its own live list.
- **Unknown input is self-service and derived — `die_unknown`.** `die_unknown
  <kind> <token> [<cmd>]` (in `common.sh`) replaces every hand-written
  "unknown … (try `tool -h`)": it prints the error and then *shows* the valid
  surface from the spec — the command list for a bad command, a command's own
  options for a bad flag — deriving the tool name from `$0`. No "(try -h)"
  strings to drift between `-h`/`--help`.
- **Wiring.** Source `lib/init.sh` (it sources `lib/describe.sh`), define
  `describe_spec`, and put `desc_help_intercept "$@"` above the dispatch `case`.
  Drift guards get show/diff/pull from `drift_describe_commands` and the whole
  surface from `drift_main` (it calls the intercept) for free. `bin/doc-to-pdf`
  (node) carries its own `SPEC` object that renders both its `--help` and
  `--describe`.
- **Effect = the risk signal an agent can't read off the flags — `desc_effect`.**
  Every command (and leaf tool) carries a Cordon blast-radius class on the ladder
  `read → local_write → vault_write → remote_write → deploy`, plus the `+network`
  / `+interactive` tags. The ladder's definitions and the
  network-vs-dependency-install rule live in
  [cordon](https://github.com/joeseverino/cordon#the-effect-ladder) — don't
  restate them here. Declare it explicitly in one line, including reads —
  `desc_effect deploy +network` after a `desc_cmd`, or after `desc_tool` for a
  leaf — scoped like `desc_opt`. Missing or duplicate declarations fail closed
  before rendering or gating, so an omitted classification can never become an
  inferred read. It renders a terse `Effect:` line in the focused `-h`, a colored
  chip in `--tui`, and rides into the JSON. The drift guards declare theirs
  **once** in `drift_describe_commands` (show/diff read+network, pull
  vault_write+network), so all four inherit. This is what lets an agent risk-gate
  `hq restart` (`deploy`) vs `vault status` (`read`) before running either.
- **Contract.** This repo emits the **complete** [Cordon `schema_version 4`](https://github.com/joeseverino/cordon#the-contract)
  document — every optional field included (`paras`/`examples`/`delegates`,
  option `metavar`/`repeatable`, positional `variadic`); the sibling
  `severino-vault-mcp` emits the same schema minus the prose fields. The field
  list, schema, and version history live in cordon; this repo's *rendering* of it
  is [`docs/command-surface-contract.md`](docs/command-surface-contract.md).
  Repo-specific rules: `desc_inventory "<group>" <order>` is required once after
  `desc_tool`, and `order` is globally unique — the canonical workflow order for
  every aggregate renderer (README, completions, TUI). `desc_para`,
  `desc_example`, and `desc_effect` are **scoped to the current command** (like
  `desc_opt`/`desc_pos`) — declare tool-level ones *before the first `desc_cmd`*
  or they attach to the last command. `desc_env` stays human-help only. Output is
  byte-deterministic (no timestamps) so guards can diff it; `describe.bats`
  guards every emitted effect against the enum, and schema validation rejects
  missing metadata and duplicate order values.
- **`tools describe`** is the orchestrator: it federates every `bin/*`
  `--describe` into one document (`--pretty` to read, `--repos` to fold in
  sibling repos like the MCP, `tools describe <tool>` for one). **`tools describe
  <tool> <command>`** projects the contract down to a single command object
  (lifting in `tool` + `effect`) — the token-minimal path an agent fetches before
  acting, instead of reading the whole surface. `tools doctor` gates that every
  tool self-describes. Because the federated document is byte-deterministic, the
  aggregate call is **content-cached** under
  `${XDG_CACHE_HOME:-~/.cache}/severino-tools/describe-<hash>.json` — the hash is
  over every `bin/*` plus the shared describe/render libs, so any spec or
  renderer edit misses and re-federates (correctness never lags content; warm
  calls go ~1.4s → ~35ms). `TOOLS_DESCRIBE_NO_CACHE=1` forces a live federation.
- `lib/describe.sh` is written to run under **bash and zsh** (no numeric array
  indexing, no `read -ra`) so the lone zsh tool (`dns-test`) self-describes from
  the same engine. `tests/describe.bats` asserts the round-trip invariant and
  bash/zsh byte-parity.

## `tools describe --tui` — the human tier (shipped 2026-06-13)

`tools describe --tui` (shorthand **`tools tui`**) is the interactive consumer of
the contract above: a full-screen Node explorer over the same `tools describe`
JSON (`lib/tools/describe-tui.mjs`), sharing the `site manage` look + polish bar
(see `[[feedback_tui_polish]]`). The three tiers stay cleanly separated: `-h`
(clean text) · `--describe` (JSON) · `--tui` (this). `tools tui` is a thin
dispatch alias to `cmd_describe --tui` — the same renderer, one less thing to
type; both stay in sync because there is only one implementation.

- **Scope: aggregate only.** A single tool stays the clean wrapped `-h` (no
  per-tool mini-TUIs); `tools describe <tool> --tui` is a usage error.
- **Opens instantly, hydrates async.** The federation runs off the event loop
  (`fetchDescribeAsync`, a `spawn` not a `spawnSync`): the alt-screen paints a
  loading frame immediately, then fills the panes when `tools describe` resolves
  — `q`/Esc work during load. SMOKE/REPLAY stay on the synchronous `load()` so
  the test harnesses still render one deterministic frame. Per-tool lazy fetch is
  deliberately *not* done: `/` filters commands across the whole toolchain, which
  needs every contract in hand.
- **Layout.** Left pane: tool list. Right pane: the selected tool's commands /
  options / args. `Tab`/`←→` switch panes, `↑↓` move, `/` filters tools *and*
  commands across the whole toolchain, `Enter` copies a ready-to-paste
  invocation (pbcopy), `q`/Esc quits. Purposeful (find-and-use a command), not
  decorative.
- **`e` expands the selected scope** into a full-screen, scrollable detail
  overlay rendering everything the contract holds for that command (or leaf
  tool): summary, effect, all args, the full reflowed `paras`, and `examples` —
  instead of truncating to a `-h` pointer. `e`/Esc closes it, `Enter`/`c` copies.
  This is the consumer that the one-logical-paragraph `desc_para` rule feeds:
  the overlay reflows real paragraphs to the pane width.
- **Reuse, don't fork — shared `lib/tui.mjs`.** The visual language and input
  plumbing (palette, grapheme-aware width/clip, `lineEditor`, `fitFrame`, the
  alt-screen/title polish bar, the escape-sequence input pump + replay key map)
  live in **`lib/tui.mjs`**, imported by both `manage-tui.mjs` and
  `describe-tui.mjs` — one implementation of the look, not two that drift. A new
  Node TUI imports it; it does **not** copy these helpers. `tests/describe-tui.bats`
  mirrors `site-manage.bats`'s `*_SMOKE` (static frame) / `*_KEYS` (replay)
  harness; `site-manage.bats` is the regression net for changes to `lib/tui.mjs`.
- Decision record (the "render-many" consumers):
  `read_doc('report-emit-once-render-many')`.

## Repo conventions

- **Solo-authored, but never commit to `main` — branch → PR.** Branch from a
  freshly fetched `origin/main` (`git fetch origin && git checkout -b <name>
  origin/main`), never from a stale local tree (multiple sessions touch these
  repos, so local `main` lags). Push, open a PR, and hand back only on green CI
  with no unresolved review comments; Joe approves or comments, then it merges.
  No `Co-Authored-By` / "Claude" trailers in commits, no AI attribution in
  messages. Commit/push/PR only when asked.
- After meaningful vault-affecting work, the operator runs `hq sync`. This is
  checked, not remembered: `hq sync` records the shipped manifest hash at
  `${XDG_STATE_HOME:-~/.local/state}/severino-tools/hq-sync.json`, and
  `vault status` / `hq doctor` report staleness from it (exact — prose-only
  edits never flag).

## Layout

- `bin/` — exactly one executable per tool, nothing else. `tools install`,
  the completions, `tools doctor`, and CI all discover tools by globbing
  `bin/*`.
- `lib/` — shared helpers flat (`common.sh`, `init.sh`, `key.sh`,
  `drift.sh`, `doctor.sh`); tool-specific support files under `lib/<tool>/`
  (e.g. `lib/site/`, `lib/doc-to-pdf/`). `drift.sh` is the shared core for
  the drift-guard tools (`ts-acl`, `cf-dns`, `adguard`, `nginx`): they
  provide `get_token`/`fetch_live`/`normalize` + config and call `drift_main`.
  All block parsing is scoped to the mirror's own heading section. A
  successful `pull` writes through the MCP's `update-mirror-block` — one
  atomic write that replaces the block *and* stamps `last_reviewed` (a pull
  is a review); it falls back to a scoped awk rewrite + `touch-reviewed` when
  the MCP CLI or `$NOTES_HOME` isn't available. `doctor.sh` owns the
  `check`/`check_warn`/`gate`/`doctor_finish` plumbing and the gate registry
  behind `tools doctor --all` / `--live` (a gate's only contract: exit 0 when
  healthy).
- `config/` — per-tool defaults derived from layout env vars. Files ending
  `.example` are templates; their gitignored copies are user-specific.
- `schemas/` — machine-enforced cross-tool contracts. Keep executable schemas
  here rather than under `docs/`; prose explaining them stays in `docs/`.
  `cordon-v4.json` is vendored **verbatim** from the canonical cordon repo (the
  single source of the command-surface contract) — edit it there, then re-vendor.
  `tools check` / `tools doctor` diff this copy against the canonical source
  (`cordon_schema_status`, resolved via `$CORDON_HOME` or the sibling checkout),
  so the copy can't silently drift; absent cordon, the check warns, not fails.
- `tests/` — bats suite. Hermetic: throwaway keys, tmpdirs, no Keychain.
- `bench/` — every measured claim in the README has a script here that
  asserts it; they run in CI.

## Calling severino-vault-mcp from this repo

We own the MCP (`~/Documents/Code/Assets/severino-vault-mcp/`). Shell tools call
it as a plain CLI — **don't** hand-edit vault frontmatter or shell out to `yq`;
the MCP is the schema-validated, atomic writer.

In `bin/site`, every call goes through the **`svmc()`** wrapper, which sets
`SVMC_VAULT_PATH="$NOTES_HOME"` and names the binary in one place:

```bash
svmc <subcommand> [args] [--pretty]     # in bin/site
SVMC_VAULT_PATH="$NOTES_HOME" severino-vault-mcp <subcommand> ...   # elsewhere
```

Add new call sites through `svmc`, never inline — an inline call that forgets
`SVMC_VAULT_PATH` silently falls back to the MCP's own configured default vault.

The console script is on PATH (`uv tool install`). Existing subcommands:
`touch-reviewed <relative-path>` (set `last_reviewed` to today) and
`update-mirror-block <relative-path> --heading <h> [--touch-reviewed]`
(stdin JSON → replace a fenced ```json mirror block, section-scoped, one
atomic write — the drift guards' pull writer; **both are CLI-only fast paths:
no MCP tool, no vault-cache rebuild**), plus `prepare-writeup-publish`,
`list-writeups`, `technology-catalog`, `validate-all-writeups`,
`reorder-featured`, `update-writeup`, `writeup-dashboard`,
`apply-writeup-plan`, `hq-manifest`, `schema`, `doctor`. Each prints JSON and
exits 0/1 on `ok`. `bin/site` is the reference caller; `lib/drift.sh:drift_touch_reviewed`
is the minimal one (overridable via `$DRIFT_REVIEW_BIN` so bats can stub it).

**Shared frontmatter schema:** the MCP's `schema.py` is the one canonical enum
contract; `severino-vault-mcp schema --json` emits it. `hq schema` regenerates
HQ's committed `docs_index/schema.json` from it, and `hq schema --check` fails on
drift (CI / pre-deploy, including the vault's Frontmatter Schema doc). Don't
hand-maintain enum lists anywhere downstream.

**No hand-rolled logic in `bin/hq`:** `hq doctor` reports the vault↔HQ gap via
`severino-vault-mcp hq-manifest --report` (not a re-walk), and `hq validate`
calls HQ's `manage.py audit_registry` (not an inline ORM script over SSH). Keep
the contract/logic in the MCP or a `manage.py` command; `bin/hq` just formats.

**Cross-repo JSON contract** (keep both sides in sync):
- One JSON object per call; exit 0 on success, 1 on failure.
- Failures use a single `{"ok": false, "error": "<message>"}` envelope
  (singular `error`). `lib/site/manage-tui.mjs` reads `json.error`; preserve
  that shape when adding or changing MCP tools.

**To expose another MCP tool to the shell:** add a subparser + handler in the
MCP's `src/severino_vault_mcp/__main__.py` (mirror an existing block), then
`site reinstall-mcp`. `site` runs the *installed* console script, so a stale
`uv tool` install is real drift — `site doctor`'s `--fingerprint` check catches
it (installed fingerprint vs source).

## Conventions (enforced by review, checked by CI)

- New bash tools: scaffold with `tools new <name>` — it emits the canonical
  skeleton. Add `--verify` to regenerate the derived README/completions and run
  `tools check --no-bench` immediately after scaffolding. Every tool sources
  `lib/init.sh`, uses `msg`/`die`/`header`/`footer` for output, and exits 0
  (success/skips), 1 (failure), 2 (usage).
- Every tool answers `-h`/`--help` and `--describe` (both from one
  `describe_spec` — see the Command-surface contract above; `tools doctor`
  gates it).
- `dns-test` is the lone zsh exception to the bash rule (but it self-describes
  from the same engine — `lib/describe.sh` is bash+zsh safe).
- Node code is ESM (`.mjs`), deps pinned in the root `package.json`,
  resolved by upward `node_modules` lookup. **Node is the JSON tool in `bin/site`**
  (URL-encoding, payloads, MCP-output parsing); `jq` belongs to the drift
  guards in `lib/drift.sh`. Keep each file on one parser.
- Adding a tool: drop it in `bin/`, then run `tools generate`. The generated
  `completions/_tools-suite` and README CLI reference/inventory both consume
  `--describe`; never hand-edit either generated block.

## Site visual comparison

When reviewing a local site change against production, use the viewer:

```sh
site compare /route/to/check/ --no-open
```

Then open the printed localhost URL with the available browser automation tool.
Don't build an ad hoc iframe page or open two unrelated tabs. The viewer gives
labeled DEV/LIVE panes, a synchronized divider, linked scrolling, route nav,
reload, and side swapping. The Astro dev server must be running (`site dev`)
unless the requested dev URL is already up.

## Verify (do this before claiming a change works)

`tools check` runs everything CI runs: shebang-driven `bash -n`/`zsh -n`/
`node --check`, shellcheck, JSON Schema validation for every describe
contract, generated-surface drift checks, the bats suite, and the bench
assertions.
`--no-bench` skips the slow step. `tools status --json` / `tools doctor --json`
give machine-readable state. `tools doctor --all` is the cross-system rollup
(hq doctor, hq schema --check, site doctor); `--live` adds the drift guards
(network + age key).

For a fast inner loop while editing one area:
- `bats tests/<file>.bats` — hermetic, ~seconds. Run it after editing `bin/site`
  or `lib/*.sh`; it catches integration regressions (e.g. a broken MCP call)
  that reading the diff will not.
- `shellcheck -x bin/<tool> lib/*.sh` — matches CI lint.

## Cautions (time-savers learned the hard way)

- **`replace_all` on a short substring is dangerous**: it will also rewrite that
  text *inside a helper you just added* (a literal MCP invocation collapsed into
  the new `svmc()` body, creating `svmc() { svmc …; }` infinite recursion). The
  bats suite caught it. Prefer targeted edits, or re-grep + run bats after a
  bulk replace.
- `encrypt`/`decrypt`/`open-age`/`lib/key.sh` handle key material — keep temp
  files mode 600, keep the exit traps, and use plain `if` (not `[[ ]] &&`) as
  the last statement in trap handlers under `set -e`.
- `config/backup.sh` and `config/site.sh` are user-local; never commit or lint
  them in CI (non-reproducible).
- **`die` (common.sh) prints to stdout** — called inside `$( )` the message is
  captured, not shown. Redirect the call `>&2` when a function runs in command
  substitution (see `drift_vault_block`).
- **`${FLAG:+x}` is wrong for 0/1 flags** — `"0"` is non-empty, so it always
  substitutes. This bypassed the decrypt Keychain cache on every call for
  weeks. Use `if (( FLAG ))`. Related: `if ! cmd; then case $? in` is dead
  code — `!` negates `$?` to 0; capture with `|| rc=$?` instead.
- Keychain access in `lib/key.sh` goes through `$KEY_SECURITY_BIN`
  (default `/usr/bin/security`) so bats can stub it — keep new call sites on
  the variable.
- Don't vendor external projects into `lib/` — tools that outgrow a script live
  in their own repo and are launched by path.
- The tools repo often carries a large in-flight changeset. Don't bundle an
  unrelated edit into the operator's pending work — make it its own commit, or
  leave it staged and say so.

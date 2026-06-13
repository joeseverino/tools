# AGENTS.md — house rules for this repo

Canonical agent guide for the personal CLI toolchain. `CLAUDE.md` is a symlink
to this file, so Claude Code and any AGENTS.md-aware tool read the same source.
Read this before editing; it answers the questions agents otherwise re-derive
from the code every session.

Small bash/zsh/node tools that share one look and feel.

## Command-surface contract (`describe`)

Every tool emits its command surface as one structured JSON document — the
**emit-once, render-many** standard (vault decision record
`read_doc('report-emit-once-render-many')`; the `.py` reference impl lives in
`severino-vault-mcp` as `cli_introspect.describe_parser`).

- **One source per tool.** A tool defines a single `describe_spec()` (the `desc_*`
  DSL in `lib/describe.sh`). Both `-h`/`--help` (generic `usage()`) **and**
  `--describe` (JSON) render from it, so the human and machine views *cannot*
  drift — there is no prose to parse. New tools get this from `tools new`.
- **Three human renderers, one spec — no hand-written sub-help.** `usage()` is
  the git-style main screen (a scannable command list + a `Run '<tool> <cmd> -h'`
  pointer; it does *not* inline per-command options). `usage_command <cmd>`
  renders one command's focused detail (summary, arguments, options), so a
  subcommand tool routes `<tool> <cmd> -h) usage_command <cmd>` instead of a
  heredoc — `tools`, `brand`, and `hq` carry zero hand-written sub-help. Declare
  a command's flags with `desc_opt`/`desc_pos` *after* its `desc_cmd` and all
  four views (main `-h`, focused `-h`, JSON, `--tui`) light up at once.
  `desc_pos … "{a,b,c}"` gives a positional a fixed choice set (e.g. an action
  arg like `key {cache,forget,status,test}`), structured into the JSON the same
  way `desc_opt` choices are. *Exception:* a command whose real flag surface is
  owned by another repo keeps a curated heredoc (e.g. `hq create` → HQ's
  `manage.py`), to point at the owner rather than duplicate it (drift).
  **Still on prose-summary flags:** `bin/site` (30 commands) is the one tool not
  yet migrated to per-command `desc_opt`/`desc_pos` — a focused follow-up against
  its own bats suite (accurate flag extraction needs per-handler care).
- **Wiring.** Source `lib/init.sh` (it sources `lib/describe.sh`), define
  `describe_spec`, and add `--describe) describe_emit "$@"; exit 0 ;;` to the
  dispatch. Drift guards get show/diff/pull from `drift_describe_commands` and
  `--describe` from `drift_main` for free. `bin/doc-to-pdf` (node) carries its
  own `SPEC` object that renders both its `--help` and `--describe`.
- **Contract** (a superset of the MCP's): `{ ok, schema_version, name,
  description, global_options:[<opt>], positionals:[<arg>],
  commands:[{name, summary, args:[<arg>]}] }`. `desc_env`/`desc_example`/
  `desc_para` are human-help only and never enter the JSON. Output is
  byte-deterministic (no timestamps) so guards can diff it.
- **`tools describe`** is the orchestrator: it federates every `bin/*`
  `--describe` into one document (`--pretty` to read, `--repos` to fold in
  sibling repos like the MCP, `tools describe <tool>` for one). `tools doctor`
  gates that every tool self-describes.
- `lib/describe.sh` is written to run under **bash and zsh** (no numeric array
  indexing, no `read -ra`) so the lone zsh tool (`dns-test`) self-describes from
  the same engine. `tests/describe.bats` asserts the round-trip invariant and
  bash/zsh byte-parity.

## `tools describe --tui` — the human tier (shipped 2026-06-13)

`tools describe --tui` is the interactive consumer of the contract above: a
full-screen Node explorer over the same `tools describe` JSON
(`lib/tools/describe-tui.mjs`), sharing the `site manage` look + polish bar (see
`[[feedback_tui_polish]]`). The three tiers stay cleanly separated: `-h` (clean
text) · `--describe` (JSON) · `--tui` (this).

- **Scope: aggregate only.** A single tool stays the clean wrapped `-h` (no
  per-tool mini-TUIs); `tools describe <tool> --tui` is a usage error.
- **Layout.** Left pane: tool list. Right pane: the selected tool's commands /
  options / args. `Tab`/`←→` switch panes, `↑↓` move, `/` filters tools *and*
  commands across the whole toolchain, `Enter` copies a ready-to-paste
  invocation (pbcopy), `q`/Esc quits. Purposeful (find-and-use a command), not
  decorative.
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

- **Solo-authored. Work on `main`.** No `Co-Authored-By` / "Claude" trailers in
  commits, no AI attribution in messages. Commit/push only when asked.
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
  skeleton. Every tool sources `lib/init.sh`, uses `msg`/`die`/`header`/
  `footer` for output, and exits 0 (success/skips), 1 (failure), 2 (usage).
- Every tool answers `-h`/`--help` and `--describe` (both from one
  `describe_spec` — see the Command-surface contract above; `tools doctor`
  gates it).
- `dns-test` is the lone zsh exception to the bash rule (but it self-describes
  from the same engine — `lib/describe.sh` is bash+zsh safe).
- Node code is ESM (`.mjs`), deps pinned in the root `package.json`,
  resolved by upward `node_modules` lookup. **Node is the JSON tool in `bin/site`**
  (URL-encoding, payloads, MCP-output parsing); `jq` belongs to the drift
  guards in `lib/drift.sh`. Keep each file on one parser.
- Adding a tool: drop it in `bin/`, add it to the `#compdef` line in
  `completions/_tools-suite` (doctor flags drift), document it in README.

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
`node --check`, shellcheck, the bats suite, and the bench assertions.
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

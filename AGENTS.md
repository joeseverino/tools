# AGENTS.md — house rules for this repo

Canonical agent guide for the personal CLI toolchain. `CLAUDE.md` is a symlink
to this file, so Claude Code and any AGENTS.md-aware tool read the same source.
Read this before editing; it answers the questions agents otherwise re-derive
from the code every session.

TypeScript tools under `lib/<tool>/` (Node 26 runs them directly, no build),
each launched by a four-line extensionless `bin/<tool>` and sharing one look and
feel. The toolchain owns nothing another system owns: infrastructure facts are
HQ's (`hq call`), publishing is the site repo's, and vault reads and
writes go through the vault MCP.

## Reusable SDK boundary

This repo is also the lightweight SDK for sibling CLIs, one-off scripts, and
agent utilities. Stable public modules live under `lib/sdk/`. Import the
narrowest module possible:

| Module | Owns |
|---|---|
| `surface.ts`, `usage.ts` | the typed tool spec, the Cordon contract and the help screens rendered from it |
| `tool.ts` | `runTool`: help and `--describe` interception, the deploy gate, command dispatch, `parsing` for `util.parseArgs` |
| `cli.ts`, `output.ts`, `color.ts` | `CliError` and exit codes, status lines and `header`/`footer`, colour through `util.styleText` |
| `process.ts`, `which.ts`, `guards.ts` | subprocesses, `command -v`, JSON validation |
| `paths.ts`, `config.ts`, `ci.ts` | `TOOLS_HOME` / `CODE_HOME` derived from the running checkout, shell-sourced `config/<name>.sh`, the CI environment |
| `svmc.ts`, `result.ts` | the vault CLI crossing, the `result-v1` envelope |

Shell consumers (sibling repos) source `lib/sdk.sh` or `lib/init.sh`: the `desc_*`
DSL in `lib/describe.sh` streams its declarations to `lib/sdk/spec-cli.ts`, so
shell tools render through the same code as the TypeScript ones. A checkout
always runs its own files (`paths.ts` and `core.sh` derive `TOOLS_HOME` from
where they live and export it to children); the exported `TOOLS_HOME` is how
programs outside tools find it. `core.sh`,
`svmc.sh` and `ci.sh` are the shell twins of the modules above; `common.sh`
aggregates them for the bats harness.

Generic structured output uses `schemas/result-v1.json`. Repository capabilities
are declared once in `config/capabilities.json` and validated against
`schemas/capabilities-v1.json`; do not add a new hardcoded sibling/consumer list.
The actual repo fleet remains derived from `repos --json`. Full usage and
extension rules: [`docs/SDK.md`](docs/SDK.md).

## Command-surface contract (`describe`)

Every tool emits its command surface as one structured JSON document conforming
to [**Cordon**](https://github.com/joeseverino/cordon), the language-agnostic
command-surface contract (the framework, schema, and emitter guide live there;
read it first). This section is the rules for this repo's TypeScript
implementation of it; the prose walkthrough is
[`docs/command-surface-contract.md`](docs/command-surface-contract.md). (Vault
decision record: `read_doc('report-emit-once-render-many')`; the Python sibling
emitter is `severino-vault-mcp`'s `cli_introspect.describe_parser`.)

- **One source, one entry point.** A tool exports `tool: ToolDefinition` from
  `lib/<tool>/main.ts`: a typed `spec` (`ToolSpec` in `lib/sdk/surface.ts`) plus
  `run` (a tool without commands, or with `leafCommands`) or `commands` (a
  handler per spec command). The launcher calls `runTool(tool)`, which renders
  `-h`/`--help` (the git-style main screen), `--describe` (the JSON) and
  `<cmd> -h` (that command's focused screen), runs the deploy gate, and only
  then dispatches. A help flag can never fall through to run an action
  (`hq sync -h`, `hq call -h`, `tools reinstall -h` all render, never
  execute). Leaf versus subcommand is read from the spec's shape, so a tool
  never restates it. A leaf tool's bare invocation is the tool's own to define
  (`backup` runs, `diagram` prints its usage). `definitionDrift` fails the run
  when a spec command has no handler or a handler has no spec command, and
  `tests/unit/fleet.test.ts` asserts it for every tool.
- **Everything per-command is spec-derived.** A command's `options`,
  `positionals`, `paras` and `examples` are scoped to it, so the focused `-h`,
  the JSON, and `--tui` light up from the one declaration. A positional's
  `choices` give it a fixed set. Keep the data model honest: flags are
  `options`, arguments are `positionals`, examples are `examples`, and `paras`
  is for genuine prose only; interactive UIs (the `--tui` explorers)
  self-document their keymaps rather than restating them in CLI help.
  **One `paras` entry is one logical paragraph: a single unwrapped string, not a
  hard-wrapped source line.** Every renderer (`-h`, the README, the `--tui`
  expand pane) reflows it to its own width, so presentation line-breaks never
  enter the source of truth; add one entry per paragraph and never an empty one.
  The validator fails closed on a paragraph that ends mid-sentence or is empty
  (`lib/tools/describe-schema.ts`).
- **Flags owned by another repo are pointed at, never restated.** `hq create`'s
  fields are HQ's `project.upsert` / `asset.upsert` input schemas. Such commands
  set `delegates: "<owner>"` instead of enumerating flags. It renders in the
  focused `-h` ("Flags are owned elsewhere: ...") and rides into the JSON, so an
  agent sees ownership without reading handlers. `hq create <kind> -h` falls
  through to HQ (the help flag is not the second argument, so interception
  skips it) and renders the owner's live field list.
- **Unknown input is self-service and derived.** `rt.dieUnknown(kind, token,
  command?)` prints the error and then shows the valid surface from the spec:
  the command list for a bad command, a command's own options for a bad flag.
  There are no "(try -h)" strings to drift. `parsing(rt, () => parseArgs(...))`
  routes `util.parseArgs` rejections of unknown flags to it.
- **Effect is the risk signal an agent cannot read off the flags.** Every
  command and leaf tool sets `effect` on the Cordon blast-radius ladder
  `read -> local_write -> vault_write -> remote_write -> deploy`, plus
  `network` and `interactive` tags. The ladder's definitions and the
  network-versus-dependency-install rule live in
  [cordon](https://github.com/joeseverino/cordon#the-effect-ladder); do not
  restate them here. `effect` is a required field, so an omitted classification
  is a compile error and can never become an inferred read. It renders a terse
  `Effect:` line in the focused `-h`, a coloured chip in `--tui`, and rides into
  the JSON. It is what lets an agent risk-gate `hq sync` (`remote_write`) versus
  `vault status` (`read`) before running either.
- **Contract.** This repo emits the complete Cordon `schema_version 4` document,
  every optional field included (`paras`/`examples`/`delegates`, option
  `metavar`/`repeatable`, positional `variadic`); the sibling
  `severino-vault-mcp` emits the same schema minus the prose fields. The field
  list, schema, and version history live in cordon; `renderContract` in
  `lib/sdk/surface.ts` is this repo's rendering, kept structurally equal to
  `cordon-spec`'s `renderSurface` by `tests/unit/surface.test.ts`. It does not
  use `renderSurface` directly because it fixes the key order the committed
  surfaces were generated with and because help must answer on a checkout
  without `node_modules`. `group` and `order` are required once per tool, and
  `order` is globally unique: the canonical workflow order for every aggregate
  renderer (README, completions, TUI). `env` is human help only. Output is
  byte-deterministic (no timestamps) so guards can diff it.
- **`tools describe`** is the orchestrator: it federates every `bin/*`
  `--describe` into one document (`--pretty` to read, `--repos` to fold in
  sibling repos like the MCP, `tools describe <tool>` for one). **`tools
  describe <tool> <command>`** projects the contract down to a single command
  object (lifting in `tool` + `effect`), the token-minimal path an agent fetches
  before acting. `tools doctor` gates that every tool self-describes. The
  tools are spawned in parallel and the aggregate is **content-cached** under
  `${XDG_CACHE_HOME:-~/.cache}/severino-tools/describe-<hash>.json`. The hash is
  over every `bin/*` and `lib/**/*.{ts,sh}`, so any spec or renderer edit misses
  and re-federates (a cold call is about 0.5s, a warm one under 0.1s).
  `TOOLS_DESCRIBE_NO_CACHE=1` forces a live federation.
- **Shell authoring.** A shell tool (a sibling repo's) declares the same surface
  with the `desc_*` DSL in a `describe_spec` function, sources `lib/init.sh`, and
  puts `desc_help_intercept "$@"` above its dispatch `case`. The DSL only
  collects records; `lib/sdk/spec-cli.ts` parses them into a `ToolSpec` and
  renders through the same code, so the output is byte-identical to a typed
  tool's. `tests/describe.bats` asserts the round-trip invariant and bash/zsh
  parity for the bridge. `bin/doc-to-pdf` is a launcher for
  `lib/doc-to-pdf/index.ts`, which carries its own `SPEC` object that renders
  both its `--help` and `--describe`.

## `tools describe --tui` — the human tier (shipped 2026-06-13)

`tools describe --tui` (shorthand **`tools tui`**) is the interactive consumer of
the contract above: a full-screen Node explorer over the same `tools describe`
JSON (`lib/tools/describe-tui.ts`), sharing the look and polish bar of every
TUI here through `lib/tui.ts`. The three tiers stay cleanly separated: `-h`
(clean text) · `--describe` (JSON) · `--tui` (this). `tools tui` is a thin
dispatch alias to `describe --tui`: the same renderer, one less thing to type;
both stay in sync because there is only one implementation.

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
  This is the consumer that the one-logical-paragraph `paras` rule feeds:
  the overlay reflows real paragraphs to the pane width.
- **Reuse, don't fork — shared `lib/tui.ts`.** The visual language and input
  plumbing (palette, grapheme-aware width/clip, `lineEditor`, `fitFrame`, the
  alt-screen/title polish bar, the escape-sequence input pump + replay key map)
  live in **`lib/tui.ts`**, imported by `describe-tui.ts`, `brief/tui.ts`, and
  `repos/tui.ts` — one implementation of the look, not copies that drift. A new
  Node TUI imports it; it does **not** copy these helpers. Each TUI has a
  `*_SMOKE` (static frame) / `*_KEYS` (replay) harness; `describe-tui.bats`,
  `brief-tui.bats`, and `repos-tui.bats` are the regression net for `lib/tui.ts`.
- Decision record (the "render-many" consumers):
  `read_doc('report-emit-once-render-many')`.

## Repo conventions

- **Solo-authored, but never commit to `main` — branch → PR.** Open work with
  `start "<slug>"` (it fetches and cuts a fresh branch off `origin/main`, carrying
  any edits), never from a stale local tree (multiple sessions touch these repos,
  so local `main` lags). Then `ship --check --go` (don't `git push` / `gh pr
  create` by hand — see the Workspace loop), and hand back only on green CI with no
  unresolved review comments; Joe approves or comments, then it merges. No
  `Co-Authored-By` / "Claude" trailers in commits, no AI attribution in messages.
  Commit/push/PR only when asked.
- After meaningful vault-affecting work, the operator runs `hq sync`. This is
  checked, not remembered: `hq sync` records the shipped manifest hash at
  `${XDG_STATE_HOME:-~/.local/state}/severino-tools/hq-sync.json`, and
  `vault status` / `hq doctor` report staleness from it (exact — prose-only
  edits never flag).

## Layout

- `bin/` — exactly one executable per tool, nothing else. Each is a four-line
  `#!/usr/bin/env node` launcher that calls `runTool(tool)`; Node's type
  stripping does not apply to an extensionless entry file, so the logic lives in
  `lib/<tool>/main.ts`. `tools install`, the completions, `tools doctor`, and CI
  discover tools by globbing `bin/*`.
- `lib/<tool>/` — one directory per tool. `main.ts` exports `tool`
  (`ToolDefinition`: the spec plus its handlers); pure logic (parsing,
  formatting, planning) sits in sibling modules so `tests/unit` can reach it.
  Node modules are TypeScript, type-checked under the strict `tsconfig.json` by
  `tools check`.
- `lib/sdk/` — the shared framework and SDK (see above). `lib/git/` is the one
  owner of git and PR mechanics. `lib/tui.ts` is the shared TUI toolkit.
- Shell that remains: `lib/hq-call` (the SSH transport, a thin `exec`),
  `lib/describe.sh`, `lib/init.sh`, `lib/common.sh`, `lib/sdk.sh` and
  `lib/sdk/{core,svmc,ci}.sh` (the authoring surface for shell consumers and the
  bats harness), and `config/*.sh`, which stay shell so they can be sourced and
  overridden from the environment (`lib/sdk/config.ts` reads them).
- `config/capabilities.json` — the one declaration of each sibling repository:
  path, install command, fingerprint, describe surface, `brief` section.
  `tools reinstall`, `tools doctor`, `brief`, and the
  contract graph all read it. Never add a second hardcoded repo list.
- `config/` — per-tool defaults derived from layout env vars. Files ending
  `.example` are templates; their gitignored copies are user-specific.
- `schemas/` — machine-enforced cross-tool contracts. Keep executable schemas
  here rather than under `docs/`; prose explaining them stays in `docs/`.
  `cordon-v4.json` is vendored **verbatim** from the canonical cordon repo (the
  single source of the command-surface contract) — edit it there, then re-vendor.
  `tools contracts --check` and the CI gate compare this copy against the pinned
  `cordon-spec` package, so the copy cannot silently drift.
- `tests/` — bats suite. Hermetic: tmpdirs, stubbed `gh`, `uv`, `mmdc`, and
  HQ transport; never the real network. CI runs it. `tests/unit/*.test.ts` are
  `node --test` tests for the pure TypeScript functions (`npm test`); `unit.bats`
  runs them inside the suite, so `tools check` and CI cover them.
- `bench/` — every measured claim in the README has a script here that
  asserts it; `tools check` runs them.

## Calling severino-vault-mcp from this repo

We own the MCP (`$CODE_HOME/Assets/severino-vault-mcp/`). Shell tools call
it as a plain CLI — **don't** hand-edit vault frontmatter or shell out to `yq`;
the MCP is the schema-validated, atomic writer.

Every call goes through the shared **`svmc()`** adapter: `lib/sdk/svmc.ts` for
TypeScript tools (`svmc(args, { input?, vaultPath? })`) and `lib/sdk/svmc.sh` for
shell consumers. It pins `SVMC_VAULT_PATH` to `$NOTES_HOME` (an explicit
`SVMC_VAULT_PATH` or `vaultPath` wins) AND names the binary in one place via
`$SVMC_BIN` (the test seam), so a call site can neither read the MCP's own
configured default vault nor dodge the hermetic stub:

```ts
const result = svmc(['brief', '--days', '7']);   // lib/backlog, lib/brief, lib/hq, ...
```

Add new call sites through the adapter, never inline: an inline
`severino-vault-mcp` call silently falls back to the MCP's own configured default
vault (and bypasses `$SVMC_BIN`). One boundary, every consumer (emit once,
derive everywhere).

The console script is on PATH (`uv tool install`); `severino-vault-mcp --help`
lists its subcommands. Each prints JSON and exits 0/1 on `ok`. Infrastructure
facts are not the MCP's: ask HQ (`hq call`).

**Shared frontmatter schema:** the MCP's `schema.py` is the one canonical enum
contract; `severino-vault-mcp schema --json` emits it. `hq schema` regenerates
HQ's committed `docs_index/schema.json` from it, and `hq schema --check` fails on
drift (CI / pre-deploy, including the vault's Frontmatter Schema doc). Don't
hand-maintain enum lists anywhere downstream.

**No hand-rolled logic in `lib/hq`:** every HQ read and write is an HQ tool
called through `lib/hq-call` (`$HQ_CALL`), the operator's transport to HQ's MCP
tool surface over the host shell (their own SSH certificate, never a shared
token, never an inline ORM script). `hq call <tool> [json]` exposes that surface
directly; `hq call get_findings` is HQ's own verdict on what is wrong. Keep the
logic in HQ or the MCP; `lib/hq` transports, and `lib/hq/report.ts` formats
what they emit. Nothing in `lib/hq` acts on the host itself: HQ's own pipeline
does.

**Cross-repo JSON contract** (keep both sides in sync):
- One JSON object per call; exit 0 on success, 1 on failure.
- Failures use a single `{"ok": false, "error": "<message>"}` envelope
  (singular `error`). Consumers read `json.error`; preserve that shape when
  adding or changing MCP tools.

**To expose another MCP tool to a tool here:** add a subparser + handler in the
MCP's `src/severino_vault_mcp/__main__.py` (mirror an existing block), then
`tools reinstall severino-vault-mcp`. Tools run the *installed* console script,
so a stale `uv tool` install is real drift; `tools doctor` catches it by
comparing the installed fingerprint with the one the checkout reports, both
computed by the MCP's own code.

## Conventions (enforced by review, checked by CI)

- New tools: scaffold with `tools new <name>` (add `--agent` for a `result-v1`
  envelope tool). It writes `bin/<name>` and `lib/<name>/main.ts` with the
  canonical skeleton; `--verify` regenerates the derived README/completions and
  runs `tools check` immediately. A tool exits 0 (success or skips), 1
  (failure), 2 (usage), and reports through `msg`/`header`/`footer`/`die` from
  `lib/sdk/output.ts` and `lib/sdk/cli.ts`.
- Every tool answers `-h`/`--help` and `--describe` from its one spec (see the
  Command-surface contract above; `tools doctor` gates it).
- Node code is TypeScript under `lib/`, run directly by Node 26 (no build) and
  type-checked strictly (including `noPropertyAccessFromIndexSignature` and
  `noImplicitReturns`): no explicit `any`, no `@ts-*` suppressions, no casts on
  parsed JSON. JSON stays `unknown` until a guard from `lib/sdk/guards.ts`
  narrows it, or until `runJson` / `spawnJson` apply the guard passed as their
  last argument. Handlers parse arguments with `util.parseArgs` in `strict`
  mode (through `parsing` so unknown flags get the shared usage error), colour
  through `lib/sdk/color.ts`/`output.ts`, and read paths from `lib/sdk/paths.ts`.
  Helpers throw (`die`, `usageError`, `CliError`); `runTool` reports the error
  and sets the exit code. Dependencies are pinned exactly in the root
  `package.json`. JSON in code is `JSON.parse` behind a guard; there is no
  Python at runtime (`marks` is the exception until it moves to severino-life).
- Comments say a non-obvious why, tersely. They do not restate the code or tell
  the history of a change.
- Adding a tool: `tools new`, then `tools generate`. The generated
  `completions/_tools-suite` and README CLI reference/inventory both consume
  `--describe`; never hand-edit either generated block.

## Workspace loop (`start` · `repos` · `ship` · `land` · `resync`)

The fleet workflow is one loop with one read owner and one write owner — match
that split when extending it, don't add a second scanner or a second merge path.

**The PR path, every time — never `git push` / `gh pr create` by hand:**

> `start "<slug>"` (fresh branch off origin/main) → edit → `ship --check --go`
> (gate locally, push, open/sync a *conventional* PR title) → `ship --watch` or
> `land --go` (squash-merge) → `resync` (ff main + prune). Let `ship` own the PR
> title; don't hand-write it. This is what keeps two sessions (you and an agent)
> from colliding: each change is a clean branch off current main, gated before it
> leaves the machine.

- **Branch safety is decided once, in `lib/git/index.ts` (`branchState`).** Never
  commit to `main` and never pile onto a stale branch: the single ladder classes
  the current branch `trunk|zombie|pr|current|stale` vs `origin/<base>`, and every
  consumer reads it: `targetBranch` (ship's write-time gate), `repos --json`
  (`branch_state` field), and the TUI queues. `start` cuts a fresh branch off
  `origin/<base>` carrying the working tree (the opening beat that makes
  branching-first one word). When ship hits a **stale** branch (committed work,
  behind base, no PR — the conflict-cascade trap) it STOPS and guides rather than
  inheriting it; `ship --rebranch` replays the commits onto a fresh branch off
  base, dropping any already merged. Don't add a second branch heuristic anywhere.
- **`repos` owns every *read*.** Git state and PR/CI state both come from
  `repos --json`. `branch_state` is the owned branch-safety verdict (above), a
  network-free hint by default and corrected to `pr` under `--prs`. `--prs` folds
  each repo's open-PR state (number, CI rollup, review) in via one `gh pr view` per
  repo with a remote (network; parallel fan-out → `lib/repos/pr.ts` projects the
  blobs back in one pass). `--fetch` refreshes remote-tracking refs first so
  `behind`/`upstream_gone`/`branch_state` are true *now*, not as of the last manual
  fetch — the unfetched counts are stale, so trust them only with `--fetch`.
  `stash` is always emitted. `start`, `ship`, `land`, and `resync` all read this
  one surface and never re-derive git state (the emit-once rule). `land`'s preview
  *is* `repos --prs`.
- **`lib/git/index.ts` owns every *write* mechanic.** Commit/push/PR/merge/sync
  live there, not inlined in a driver. The single merge mechanic is
  **`mergePr`** (`--squash|--merge|--rebase` + optional `--admin`); `land`
  (require-green policy) and `lib/land/main.ts` (explicit green-gate + `--admin`
  policy) both ride it. Add a new git/PR mechanic here and call it from the driver.
- **`land` is the merge beat** (`ship → land → resync`): merges the open PR for the
  current branch and deletes it. Dry-run + single-repo by default, fleet behind
  `--all` (same guard shape as `ship`). It skips a non-green PR unless `--admin`
  (the solo-repo / land-ahead-of-CI override). `ship --watch` ends by pointing at
  `land`; `land` ends by pointing at `resync`.
- **All GitHub calls go through `GH_BIN`** (default `gh`), in `lib/repos`,
  `lib/land`, `lib/ship` and `lib/git/index.ts`, so the suites shadow `gh` with `tests/fixtures/gh` (a
  hermetic stub: branch-name → canned PR JSON; `pr merge` logged to
  `$GH_MERGE_LOG`). Never call bare `gh`; add the call site through `GH_BIN`.
- **The `repos tui` PR tier loads in two phases.** It paints the fast local
  snapshot (`repos --json`), then hydrates PR/CI state (`repos --json --prs`)
  asynchronously and splices it in by path (`mergePrs`) — startup stays instant.
  Tests opt into PR rendering with `REPOS_TUI_PRS=1` (sync merge against the gh
  stub). Actions tagged `background:true` (open a URL) run detached and never tear
  down the alt-screen; foreground actions (ship/land/resync/diff/shell) use the
  leave-alt dance.
- **`brief tui` is the workspace cockpit** — the interactive face of `brief`. It
  renders `brief --json --prs` (no scanning of its own) as ONE severity-ranked
  "what needs you" queue across surfaces: green PRs → `land`, dirty → `ship`,
  merged → `resync`, then vault to-review / inbox / writeup drafts (reminders that
  copy a string). It re-invokes `brief --json --prs` via `$BRIEF_BIN` (tests feed a
  canned digest stub — no repos/vault/gh). `brief` is a leaf-with-subcommand
  (`leafCommands` + a `tui` command), so bare `brief` still runs the briefing.
- **The action runner is shared (`lib/tui.ts`), not per-TUI.** `runForegroundAction`
  (the raw-mode/alt-screen/`waitForReturn` dance) and `spawnDetached`/`spawnInherit`
  live in `lib/tui.ts`; both `repos tui` and `brief tui` import them. A new TUI
  imports the runner — it does not reimplement the spawn dance, exactly as it
  imports the palette/width helpers.

## Verify (do this before claiming a change works)

`tools check` runs everything CI runs and more: `bash -n`/`zsh -n` over any
remaining shell scripts, the strict TypeScript type-check, shellcheck, JSON
Schema validation for every describe contract, generated-surface drift checks,
the bats suite (which runs the `node --test` unit tests), and the bench
assertions.
`--no-bench` skips the slow step. **`tools check --ci`** runs that same gate
under the CI-equivalent environment — this checkout's `bin/` first with the
install dir off `$PATH` (no stale `~/.local/bin` shadow), an empty global/system
git config (no leaked `init.defaultBranch`, aliases, or hooks), and the bats
version surfaced — so a local pass means a CI pass. That hermetic profile is
defined once in `lib/sdk/ci.ts` (`applyCiEnv`, with `ci_shell_env` in
`lib/sdk/ci.sh` as its shell twin) and shared with the bats harness
(`tests/helpers.bash`); `ship --check` runs `tools check --ci`. Set
`TOOLS_CI_BATS_VERSION` to fail the gate on a bats version other than CI's.
`tools status --json` / `tools doctor --json`
give machine-readable state. `tools doctor --all` is the cross-system rollup
(`hq doctor`); `--live` adds HQ's findings (`hq call get_findings`, over SSH).

For a fast inner loop while editing one area:
- `bats tests/<file>.bats` — hermetic, ~seconds. Run it after editing a tool; it
  catches integration regressions (e.g. a broken MCP call) that reading the diff
  will not.
- `npm run typecheck` — the strict TypeScript check alone.
- `npm test`: the `node --test` unit tests alone.
- `shellcheck -x lib/*.sh lib/sdk/*.sh config/*.sh.example` — matches CI lint of the remaining shell.

## Cautions (time-savers learned the hard way)

- `config/backup.sh` and `config/hq.sh` are user-local; never commit or lint
  them in CI (non-reproducible).
- External binaries the suites must stub are named through a variable: `$GH_BIN`
  (gh), `$UV_BIN` (uv), `$MMDC_BIN` (mermaid-cli), `$HQ_CALL` (the HQ
  transport), `$SVMC_BIN` (the vault MCP), `$EDITOR`. Keep new call sites on the
  variable.
- **Shell-printed label columns pad by bytes.** `printf '%-10s'` pads by byte
  count, so `msgLine` pads with `padBytes` to keep multibyte labels aligned the
  way the shell tools had them.
- **A `[[ … ]]` or `! cmd` before a test's last line never fails it.** Bash
  exempts both from errexit, so a false one is silently ignored (82 such
  assertions once hid a stale test and an over-broad check). `[ … ]` and plain
  commands such as `grep` do gate. Give every non-final `[[ ]]` or `!` line a
  `|| return 1`, or chain the assertions into one statement. Watch for `grep`
  eating a leading-dash needle (`grep -qF -- "--admin"`).
- Don't vendor external projects into `lib/` — tools that outgrow a script live
  in their own repo and are launched by path.
- The tools repo often carries a large in-flight changeset. Don't bundle an
  unrelated edit into the operator's pending work — make it its own commit, or
  leave it staged and say so.

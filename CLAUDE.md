# CLAUDE.md — house rules for this repo

Personal CLI toolchain. Small bash/zsh/node tools that share one look and
feel. Read this before editing; it answers the questions agents otherwise
re-derive from the code every session.

## Layout

- `bin/` — exactly one executable per tool, nothing else. `tools install`,
  the completions, `tools doctor`, and CI all discover tools by globbing
  `bin/*`.
- `lib/` — shared helpers flat (`common.sh`, `init.sh`, `key.sh`,
  `drift.sh`); tool-specific support files under `lib/<tool>/` (e.g.
  `lib/hq/`, `lib/site/`, `lib/doc-to-pdf/`). `drift.sh` is the shared core
  for the drift-guard tools (`ts-acl`, `cf-dns`, `adguard`, `nginx`): they
  provide `get_token`/`fetch_live`/`normalize` + config and call `drift_main`.
  On a successful `pull`, `drift.sh` stamps the vault doc's `last_reviewed`
  through the MCP (see below) — a pull is a review.

## Calling the severino-vault-mcp from this repo

We own the MCP (`~/Documents/Code/Assets/severino-vault-mcp/`). Shell tools
call it as a plain CLI — **don't** hand-edit vault frontmatter or shell out to
`yq`; the MCP is the schema-validated writer that also reloads the vault cache:

```bash
SVMC_VAULT_PATH="$NOTES_HOME" severino-vault-mcp <subcommand> [args] [--pretty]
```

The console script is on PATH (`uv tool install`). Existing subcommands:
`touch-reviewed <relative-path>` (set `last_reviewed` to today — used by
`drift.sh`), `prepare-writeup-publish`, `list-writeups`, `technology-catalog`,
`validate-all-writeups`, `reorder-featured`, `update-writeup`, `doctor`. Each
wraps the same-named tool in `server.py`, prints JSON, and exits 0/1 on `ok`.
`bin/site` is the reference caller; `lib/drift.sh:drift_touch_reviewed` is the
minimal one (overridable via `$DRIFT_REVIEW_BIN` so bats can stub it).

**To expose another MCP tool to the shell:** add a subparser + handler in the
MCP's `src/severino_vault_mcp/__main__.py` (mirror an existing block), then
`site reinstall-mcp` to make the new subcommand live (a stale `uv tool` install
is what `site doctor`'s fingerprint check catches).
- `config/` — per-tool defaults derived from layout env vars. Files ending
  `.example` are templates; their gitignored copies are user-specific.
- `tests/` — bats suite. Hermetic: throwaway keys, tmpdirs, no Keychain.
- `bench/` — every measured claim in the README has a script here that
  asserts it; they run in CI.

## Conventions (enforced by review, checked by CI)

- New bash tools: scaffold with `tools new <name>` — it emits the canonical
  skeleton. Every tool sources `lib/init.sh`, uses `msg`/`die`/`header`/
  `footer` for output, and exits 0 (success/skips), 1 (failure), 2 (usage).
- Every tool answers `-h`/`--help`.
- `dns-test` is the lone zsh exception to the bash rule.
- Node code is ESM (`.mjs`), deps pinned in the root `package.json`,
  resolved by upward `node_modules` lookup.
- Adding a tool: drop it in `bin/`, add it to the `#compdef` line in
  `completions/_tools-suite` (doctor flags drift), document it in README.

## Verify

`tools check` runs everything CI runs: shebang-driven `bash -n`/`zsh -n`/
`node --check`, shellcheck, the bats suite, and the bench assertions.
Run it before claiming a change works. `--no-bench` skips the slow step.

`tools status --json` / `tools doctor --json` give machine-readable state.

## Cautions

- `encrypt`/`decrypt`/`open-age`/`lib/key.sh` handle key material — keep
  temp files mode 600, keep the exit traps, and use plain `if` (not
  `[[ ]] &&`) as the last statement in trap handlers under `set -e`.
- `config/backup.sh` and `config/site.sh` are user-local; never commit them
  or lint them in CI (non-reproducible).
- Don't vendor external projects into `lib/` — tools that outgrow a script
  (e.g. sitedrift) live in their own repo and are launched by path.

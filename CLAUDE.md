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
  for the drift-guard tools (`ts-acl`, `cf-dns`, `adguard`): they provide
  `get_token`/`fetch_live`/`normalize` + config and call `drift_main`.
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

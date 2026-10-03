# Contributing

Bug reports and PRs welcome. A few ground rules:

## Before opening a PR

- Run `tools check`. It runs what CI runs (`bash -n`/`zsh -n`, the strict
  TypeScript type-check, shellcheck, contract validation, the bats suite) plus
  the bench assertions. Green locally means green on the PR.
- Match the existing style:
  - 4-space indent
  - `#!/usr/bin/env bash` + `set -euo pipefail`, except `dns-test`
    (`#!/bin/zsh`), which uses zsh-specific idioms.
  - Node code is TypeScript under `lib/`: strict, no explicit `any`.
  - `lib/init.sh` sourcing pattern for any new tool.
  - Status output via `msg` / `header` / `footer` / `die` — don't
    invent new colors or layouts unless the tool genuinely needs
    something different.
- Add `-h` / `--help` output for any new tool.
- New tools start with `tools new <name>` — it scaffolds the canonical
  skeleton in `bin/`, and `tools install`, `tools doctor`, and CI
  discover it automatically. Tool-specific support files go in
  `lib/<tool>/`; only code shared by two or more tools belongs flat in
  `lib/`. Then `tools generate` rebuilds the completions and README reference.
- Behavior that matters gets a bats test in `tests/`. Tests must stay
  hermetic: tmpdirs, stubbed binaries, no network.

## Scope

This is a personal toolkit. PRs that broaden it into a general-purpose
framework will probably be declined — keep additions small, focused,
and within the existing patterns.

Good fits: new `lib/` helpers that two or more tools would share;
fixing bugs; cross-platform compatibility for the non-macOS-specific
bits; better tests; clearer error messages.

Bad fits: turning this into a plugin system; abstracting the output
layer; rewriting in another language.

## Security

See [SECURITY.md](SECURITY.md). Say so in the PR description if a change adds a
credential, calls `op`, widens what `lib/hq-call` can reach, or changes a
command's declared effect.

# Contributing

Bug reports and PRs welcome. A few ground rules:

## Before opening a PR

- Run `bash -n` on bash scripts and `zsh -n` on `dns-test`. CI does
  this on every push but it's faster to catch locally.
- Run `shellcheck` on anything you touch. Existing scripts pass
  shellcheck with default settings; please don't regress that.
- Match the existing style:
  - 4-space indent
  - `#!/usr/bin/env bash` + `set -euo pipefail`, except `dns-test`
    (`#!/bin/zsh`) which uses zsh-specific idioms.
  - `lib/init.sh` sourcing pattern for any new tool.
  - Status output via `msg` / `header` / `footer` / `die` — don't
    invent new colors or layouts unless the tool genuinely needs
    something different.
- Add `-h` / `--help` output for any new tool.
- If you add a new tool, add it to `TOOL_NAMES` in `tools` (so
  `tools install` / `tools doctor` pick it up) and to the
  completion file in `completions/_tools-suite`.

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

The crypt tools handle private key material. If you're touching
`decrypt`, `open-age`, `lib/key.sh`, or any of the Keychain plumbing,
say so explicitly in the PR description and explain the threat model
of the change. Don't loosen the temp-file permissions or remove the
exit traps.

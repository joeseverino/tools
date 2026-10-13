# Contributing

Bug reports and PRs welcome. A few ground rules:

## Before opening a PR

- Run `tools check`. It runs what CI runs (the strict TypeScript type-check,
  shellcheck and `bash -n` over the remaining shell, contract validation, the
  bats suite and the unit tests) plus the bench assertions. Green locally means
  green on the PR.
- Match the existing style:
  - 2-space indent in TypeScript, 4-space in shell.
  - Tools are TypeScript under `lib/<tool>/`: strict, no explicit `any`, no
    non-null assertions, arguments through `util.parseArgs` in strict mode.
  - A tool declares a typed `ToolSpec` and exports `tool`; `bin/<tool>` is the
    four-line launcher `tools new` writes.
  - Status output via `msg` / `header` / `footer` / `die` from `lib/sdk` — don't
    invent new colors or layouts unless the tool genuinely needs
    something different.
  - Comments explain a non-obvious why in plain language; they do not restate
    the code.
- Every tool answers `-h` / `--help` and `--describe`; both come from its spec.
- New tools start with `tools new <name>` — it scaffolds `bin/<name>` and
  `lib/<name>/main.ts`, and `tools install`, `tools doctor`, and CI
  discover it automatically. Tool-specific support files go in
  `lib/<tool>/`; only code shared by two or more tools belongs in `lib/sdk/`.
  Then `tools generate` rebuilds the completions and README reference.
- Behavior that matters gets a bats test in `tests/`. Pure TypeScript
  functions get a `node --test` test in `tests/unit/` (`npm test`). Tests must
  stay hermetic: tmpdirs, stubbed binaries, no network.

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

# Security model

This toolchain holds no secrets. It keeps no credential registry, no key
material, and no cached passphrase, and it reaches the systems that do hold
secrets with your own identity rather than a token of its own.

## What it touches

- **HQ.** `hq call`, `hq drift`, `hq sync`, and the other HQ commands run HQ's
  own tools over SSH (`lib/hq-call`). The login is your 12-hour SSH
  certificate, signed through 1Password with Touch ID, and root on the host
  comes from your forwarded agent. There is no shared token to steal, and a
  write HQ holds for approval stays held.
- **1Password.** Only `hq env-diff` and `hq dev`/`hq doctor --env` read the
  `severino-hq env` item, through the 1Password CLI and its approval prompt.
  `env-diff` prints key names only; the others print a fixed list of named,
  non-secret settings (time zone, reporting windows).
- **Everything else** (vault sync, the repo loop, diagrams, PDFs) handles
  repository content, not credentials.

## Threat model

- **A leaked checkout or backup** exposes code and tracked defaults only. User
  paths live in gitignored `config/*.sh` copies, which hold no secrets either.
- **Code running in your session** (a script, a compromised dependency, an
  agent) gets nothing standing: every credential release goes through a Touch
  ID or 1Password prompt that only you can answer.
- **A command's blast radius** is declared in its contract (`desc_effect`), so
  an agent can tell a `deploy` from a `read` before it runs anything, and a
  `deploy` asks for confirmation unless `TOOLS_ASSUME_YES=1`.

## Changes that need a security note

State the threat-model impact in the PR description for any change that adds a
credential, calls `op`, widens what `lib/hq-call` can reach, or changes a
command's declared effect.

# Security model

How this toolchain handles secrets, and — just as important — what it does
**not** protect against. Read the threat model before trusting it with anything.

## Secrets at rest

Every credential these tools touch (the age key, SSH keys, the `ts-acl`
Tailscale token / OAuth client secret, anything you `encrypt`) is stored
**age-encrypted**. Plaintext exists only in process memory for the duration of a
single command: `decrypt -p` streams to the consuming process and never writes a
plaintext file (`open-age` decrypts to `$TMPDIR` and shreds on exit via trap).

Consequence: iCloud Drive, git history, and `$BACKUPS_HOME` only ever hold
ciphertext. A leaked repo, a synced copy, or a stolen disk image yields nothing
usable on its own.

## The passphrase

The age private key is itself passphrase-protected, and that passphrase lives
**only in the macOS login Keychain** (service `age-key-passphrase`), never in a
file on disk. It is set up once per Mac (`tools key cache`) and its release is
gated by the OS Keychain — see the Threat model for what that gate stops. See
`lib/key.sh`.

## Threat model

Two layers, do not conflate them.

- **Files at rest — strongly protected (verified).** Every secret is
  age-encrypted; iCloud Drive, git history, and `$BACKUPS_HOME` only ever hold
  ciphertext. The age key is itself SSH-passphrase-protected and that passphrase
  is never on disk. An adversary with only the files — stolen backup, leaked
  repo, synced copy — gets nothing usable.
- **Live decrypt — gated by an out-of-band prompt (verified).** Unlocking the
  age key requires its passphrase, entered through a macOS prompt (a GUI dialog
  when the caller has no TTY). In testing, a non-interactive agent shell could
  **not** complete a decrypt on its own: every attempt failed unless the
  passphrase was entered by the human at that prompt. So code running in your
  session — a shell script, a compromised dependency, an AI agent in your
  terminal — cannot silently exfiltrate a secret. At most it triggers the
  prompt, which only you can answer, on your screen, outside that process.

The gate is **you**, answering an out-of-band prompt — not merely discipline
about what gets printed.

> **Open item (don't over-trust either way):** the exact Keychain caching
> behavior is not fully pinned down. In one test a raw `security -w` read
> returned a cached value even though `decrypt` still required a prompt. Until
> that's understood, treat the interactive prompt as the real gate: don't assume
> the cache is freely readable, and don't assume it never is. Tracked for
> follow-up.

## Hardening

- `tools key forget` removes any cached passphrase, forcing a prompt on every
  decrypt (guarantees the out-of-band gate).
- Scope credentials to least privilege so anything that *is* decrypted can do
  little — e.g. `ts-acl` with a read-only `acl:read` Tailscale token rather than
  a full-account API token.
- Tools still stream secrets to their destination and never print them
  (`ts-acl` sends the token to Tailscale, emits only the policy). Defense in
  depth, not the primary gate.

## Reporting / changing crypto

Per `CONTRIBUTING.md`: any change to `encrypt`, `decrypt`, `open-age`,
`lib/key.sh`, or the Keychain plumbing must state the threat-model impact
explicitly in the PR description.

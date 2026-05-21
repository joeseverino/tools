# tools

A small suite of personal CLI tools that share a common look and feel —
colored output, aligned status lines, meaningful exit codes, and `-h`
help on every command. Cohesive enough to feel like one program even
though each tool is a standalone script.

**Platform:** macOS only. The crypt tools rely on `/usr/bin/security`
(Keychain), `osascript` (passphrase dialogs), and `open -W`. The
`tools watch` agent uses `launchctl`. None of this has Linux/WSL
equivalents in-tree.

**Requirements:**

- `bash` ≥ 4 (Homebrew: `brew install bash`) — macOS ships 3.2, which
  is missing associative arrays used by `tools doctor`.
- `zsh` ≥ 5 — for the completion file and `dns-test`.
- `age`, `git`, `rsync` — `brew install age git rsync`.
- An age-compatible identity (SSH ed25519 is fine).

## What's in the box

```
tools/
  tools                # umbrella: status / doctor / install / watch / key
  encrypt              # crypt: lock files
  decrypt              # crypt: unlock files (Keychain-cached passphrase)
  open-age             # crypt: decrypt → open in default app → shred temp
  inbox                # vault: capture a quick note
  vault                # vault: sync / status / inbox listing
  backup               # backup: mirror tracked files into $BACKUPS_HOME
  dns-test             # diag: compare DNS resolver latency across paths
  hq                   # severino-hq: sync vault frontmatter → HQ docs index
  site                 # jseverino.com: vault → Astro build → Cloudflare Pages
  lib/
    common.sh          # shared: colors, msg, die, header, footer, state
    init.sh            # bootstrap sourced by every tool
    key.sh             # SSH passphrase + age-key unlock
    hq-manifest.py     # severino-hq: extract YAML frontmatter, emit manifest JSON
  config/
    crypt.sh           # default key paths from $KEYS_HOME
    vault.sh           # default vault + inbox paths from $NOTES_HOME
    hq.sh              # HQ_SSH_HOST + HQ_REMOTE_PATH + HQ_URL guards
    site.sh.example    # template — copy to site.sh: site path + dev host
    backup.sh.example  # template — copy to backup.sh, edit, ignore
  completions/
    _tools-suite       # zsh completion for every tool
```

## Install

```sh
brew install bash zsh age git rsync
git clone <this-repo> ~/path/to/tools
export TOOLS_HOME=~/path/to/tools   # add this to ~/.zshrc

cp config/backup.sh.example config/backup.sh   # then edit for your files
tools install                                  # symlinks into ~/.local/bin
tools doctor                                   # verify env, deps, symlinks
tools key cache                                # one-time passphrase cache
```

`tools install` is idempotent — re-run after pulling or adding a new
tool to refresh the symlinks. Override the install target with
`TOOLS_INSTALL_DIR=/somewhere/else tools install`. Make sure that
directory is on `$PATH`.

### Layout env vars

Each tool resolves paths in two tiers:

1. **Tool-specific env var** (e.g. `AGE_PUBKEY`, `VAULT`) — explicit
   per-invocation override; takes precedence.
2. **Layout var** (e.g. `KEYS_HOME`, `NOTES_HOME`) — required, read
   from your shell environment; tools error out with a clear message if
   not set.

Example `.zshrc` block — adapt to your own paths:

```sh
export TOOLS_HOME="$HOME/code/tools"          # this repo
export NOTES_HOME="$HOME/code/notes"          # vault repo (with .git/)
export KEYS_HOME="$HOME/code/keys"            # age public/private key pair
export BACKUPS_HOME="$HOME/code/backups"      # mirror destination
```

`config/vault.sh` and `config/crypt.sh` synthesize the derived paths
(`VAULT`, `INBOX_DIR`, `AGE_PUBKEY`, `AGE_KEY`) from these. Change a
layout var and every tool follows.

If you reorganize, edit only the layout vars in `~/.zshrc` — never the
tracked configs.

### Zsh completion

Add this to `~/.zshrc` **before** `compinit`:

```sh
fpath=("$TOOLS_HOME/completions" $fpath)
```

Then restart your shell. You get subcommand completion for `vault` and
`tools`, key-file completion for `encrypt -k` / `decrypt -k`, and flag
completion for everything.

## Conventions

- **Output**: header → status lines → optional summary → trailing newline.
- **Status lines**: a colored verb (`encrypted`, `captured`, `pulled`,
  etc.) in a fixed-width column, then the path or detail, then optional
  dim context.
- **Exit codes**: `0` success or only-skips, `1` at least one failure,
  `2` usage error (bad flag, missing args).
- **Flags**: `-h` / `--help` always works. `-f` / `--force` opts into
  clobber where it makes sense.

## Tools

### tools

Umbrella command for managing the suite itself.

```
tools status     # vault + inbox + backup + keys, one screen
tools doctor     # verify env vars, deps, key paths, and symlinks
tools install    # idempotent: create/refresh symlinks
tools key        # cache / forget / test the age key passphrase
tools watch      # opt-in: launchd auto-sync (off by default)
```

`tools status` is the daily health check; `tools doctor` is the
new-machine smoke test. `TOOLS_INSTALL_DIR` overrides the install
target.

#### tools key — passphrase cache

If your `$AGE_KEY` is a passphrase-protected SSH key (the default
ed25519 with `ssh-keygen`'s prompt), `decrypt` and `open-age` would
otherwise prompt for the passphrase on every call. Cache it in the
login Keychain once:

```
tools key cache    # prompt → validate → store in Keychain
tools key forget   # remove
tools key status   # is one cached?
tools key test     # verify the cached passphrase still unlocks $AGE_KEY
```

After `tools key cache`, every `decrypt`, `open-age`, and Finder
integration runs silently — no prompts, no terminal popups.

**How it works.** Storage is `/usr/bin/security` under service
`age-key-passphrase`, account `$USER` — same mechanism as
`git-credential-osxkeychain`. When `decrypt` runs:

1. Fetch cached passphrase from Keychain (silent if cached).
2. Copy `$AGE_KEY` to a fresh `$TMPDIR` file (mode 600).
3. Run `ssh-keygen -p -P <passphrase>` to strip the passphrase from
   the copy (canonical OpenSSH unlock — no `expect`, no pseudo-TTYs).
4. Pass the unlocked copy to `age -i` for the actual decryption.
5. Delete the unlocked copy on exit (trap covers crashes too).

**Threat model.** Cached with `-A` (any app running as you can read
it) — same effective protection as the SSH key file's mode 600. Not
a security upgrade over the file; a UX upgrade for non-interactive
contexts. The key file's passphrase still protects it in iCloud, git
history, and backups.

Bypass the cache for a single call: `decrypt --no-cache file.age`.

#### tools watch — opt-in auto-sync

```
tools watch enable     # install ~/Library/LaunchAgents plist + load
tools watch disable    # unload + remove
tools watch status     # is the agent loaded? + last few log lines
tools watch run-now    # one-shot vault sync (no schedule change)
```

Off by default. When enabled, launchd fires `vault sync` every
`TOOLS_WATCH_INTERVAL` seconds (default 900 = 15 min). Output appended
to `tools/.logs/vault-sync.log` (gitignored). Override the launchd
label via `TOOLS_WATCH_LABEL` (default `com.tools.vault-sync`).

---

### encrypt / decrypt

Wrappers around [age](https://github.com/FiloSottile/age) for locking
and unlocking files with an SSH ed25519 key.

```
encrypt [options] <file>...
decrypt [options] <file.age>...
```

Common options:

```
-c, --copy          Keep the original file (encrypt only)
-f, --force         Overwrite existing output files
-k, --key <path>    Add another key (repeatable)
                    encrypt: a public key, used as additional recipient
                    decrypt: a private key, tried as additional identity
-p, --stdout        decrypt only: write decrypted bytes to stdout instead
                    of a file. Status/errors go to stderr — pipe-safe.
-h, --help          Show usage
```

`encrypt` removes the plaintext after successful encryption unless
`-c` is given. `decrypt` always leaves the `.age` file in place.
Use `decrypt -p` to view or pipe a secret without leaving plaintext on
disk: `decrypt -p secret.age | less`.

#### Examples

```sh
encrypt notes.md secrets.txt              # original removed
encrypt -c ~/.ssh/id_ed25519              # original kept
encrypt -k ~/keys/coworker.pub notes.md   # default + coworker
decrypt notes.md.age
decrypt -k ~/keys/oldkey notes.md.age     # add a second identity to try
decrypt -p config.json.age | jq .          # view without touching disk
decrypt --no-cache notes.md.age            # ignore cache, age prompts directly
```

---

### open-age

Decrypt-and-open for `.age` files. Pulls plaintext into `$TMPDIR`
(mode 600), opens it in the OS-default app for the underlying
extension via `open -W`, then removes the temp when the app finishes
with it. Plaintext never lands in the source directory or anywhere
persistent.

```
open-age <file.age>
```

Set as the macOS default opener for `.age` to make double-clicking
"just work":

```sh
brew install duti
duti -s com.apple.Terminal .age all   # or your own .app bundle id
```

For multi-window editors (VS Code, Sublime), `open -W` returns when
the *editor* exits, not when you close the window. For those flows,
prefer `decrypt -p file.age | <viewer>` (no temp file at all) or use
a single-document app as the default for `.age`.

---

### inbox

Quick-capture a note into the vault inbox folder.

```
inbox [options] [text...]
cmd | inbox [options]
```

Filename is `YYYY-MM-DD HHMMSS <first words>.md` so notes sort
chronologically and have a readable name. Body is the captured text,
prefixed with a small `created:` frontmatter block.

Options:

```
-e, --edit    Open the captured note in $EDITOR after writing.
              With no args/stdin, creates an empty note, opens the
              editor, then renames the file from its first non-empty
              content line on save.
-h, --help    Show usage
```

#### Examples

```sh
inbox "remember to update the homelab certs"
pbpaste | inbox                            # capture clipboard
echo "$URL" | inbox                        # capture a URL
inbox -e                                   # blank note, opens $EDITOR
inbox -e "draft: post-mortem template"     # seed + open $EDITOR
```

Defaults in `config/vault.sh`. Override with `VAULT` or `INBOX_DIR`.

---

### vault

Operations on the vault repo.

```
vault sync       # git pull --rebase, then git push
vault status     # working tree, inbox count, remote sync state
vault inbox      # list pending notes in the inbox
```

Defaults in `config/vault.sh`.

---

### hq

Glue between an Obsidian vault and **Severino HQ** — a small private Django
ops app (sources at [`joeseverino/severino-hq`](https://github.com/joeseverino/severino-hq))
that I use as a documentation + projects + assets index. `hq` reads YAML
frontmatter from every `.md` under `01 Projects/`, `02 Infrastructure/`,
`03 Runbooks/` and upserts the HQ docs index, and wraps the routine
`ssh + docker compose` calls for managing the deployment.

```
hq sync          # walk vault → push manifest → HQ upserts by doc_id
hq doctor        # report docs missing or with invalid frontmatter
hq manifest      # print the manifest JSON to stdout (inspect / pipe)
hq create <kind> <slug> [flags]   # upsert a Project or Asset record
hq deploy        # git pull + docker compose up -d --build on $HQ_SSH_HOST
hq logs [-f]     # app container logs (default --tail 50)
hq restart       # docker compose restart app (no rebuild)
hq open          # open $HQ_URL in the browser
hq shell         # ssh -t into the HQ Django shell
hq superuser     # ssh -t and run createsuperuser
hq export 2026   # download year-summary-2026.md from HQ
```

`hq <subcommand> --help` for full flag lists. Subcommands that touch HQ
records (`sync`, `create`) are idempotent — re-running upserts by key.

`config/hq.sh` requires three env vars in your `~/.zshrc`:

```bash
export HQ_SSH_HOST=hq-host                       # entry in ~/.ssh/config
export HQ_REMOTE_PATH=/opt/apps/severino-hq      # path on the server
export HQ_URL=https://hq.example.com             # URL where HQ is served
```

`sync` pipes the manifest through `ssh "$HQ_SSH_HOST"` and runs
`docker compose exec -T app python manage.py import_docs_manifest -` on the
target container. `deploy` / `logs` / `restart` wrap the equivalent
`docker compose` calls; they assume `severino-hq`'s repo layout but are easy
to adapt if you fork.

#### Example workflow

A typical day touches three surfaces — vault docs, HQ records, and the
running container — without leaving the terminal:

```bash
# Edit a runbook in Obsidian, bump last_reviewed in the frontmatter, save.
hq sync                              # push the change to HQ's docs index

# Add a new project + supporting asset.
hq create project my-tool \
    --name "My Tool" --category automation --status active \
    --repo https://github.com/me/my-tool
hq create asset my-tool-com --name "my-tool.com" --category domain

# Ship a code change to the Django app.
cd ~/Projects/severino-hq && git push origin main
hq deploy                            # pulls + rebuilds on $HQ_SSH_HOST

# Tail logs after deploy. Restart if you only edited the .env on the server.
hq logs --tail 100
hq restart
```

Every subcommand is idempotent (`sync`, `create`, `deploy`) or read-only
(`logs`, `manifest`, `doctor`), so the whole flow is safe to retry.

#### Adding a new doc

1. Copy `00 Templates/Runbook.md` (or `Infra Doc.md` / `Decision Record.md`) in the vault.
2. Fill in `doc_id`, `title`, `system`, the rest of the frontmatter.
3. `hq sync`.

#### Editing an existing doc

Change its frontmatter (e.g. bump `last_reviewed`, flip `status` to `deprecated`),
save, `hq sync`. The doc_id is the upsert key — no duplicates.

---

### site

Publishing workflow for the public `jseverino.com` Astro site (sources at
[`joeseverino/jseverino.com`](https://github.com/joeseverino/jseverino.com)).
The Obsidian vault is the source of truth: `site` syncs the public pages and
writeups out of the vault, builds the static output with Astro, and ships it
to Cloudflare Pages.

```
site status              # repo location, git state, build-output state
site sync                # vault → src/content + public assets
site check               # Astro diagnostics
site build               # full Astro build
site publish             # clean + sync + check + build + audit
site publish-all         # hq sync + publish + auto-commit + push — one command
site new-writeup <slug>  # scaffold a vault writeup from the template
site dev [--drafts]      # local Astro dev server (--drafts: include drafts)
site open                # open the local dev URL
site og                  # regenerate the Open Graph social card
```

`site publish-all` is the everyday path: edit a writeup in Obsidian, run it,
and the synced snapshot is auto-committed and pushed when content changed —
Cloudflare rebuilds within ~30s. If the sync produces no content diff, the
command skips both commit and push. The commit message is built from the diff:
it names each slug as published (new), edited, or removed. `--no-push` stops
after the local build when you want to review the diff first. `site <subcommand> --help` for flag
details.

Layout resolves from env vars, all with defaults:

```bash
export CODE_HOME="$HOME/Documents/Code"             # defaults shown
export SITE_HOME="$CODE_HOME/Projects/jseverino.com"
export NOTES_HOME="$CODE_HOME/Severino Labs"        # vault root
```

`config/site.sh` (copy from `site.sh.example`) is sourced last for further
overrides — `SITE_DEV_HOST`, `SITE_DEV_PORT`.

---

### backup

Mirror tracked files into `$BACKUPS_HOME` using the source/destination
pairs listed in `config/backup.sh`. Uses `rsync -a` so permissions,
xattrs, and timestamps are preserved and unchanged files are skipped
at the byte level. Directory destinations are mirrored with
`--delete`, so they always match the source contents exactly.

```
backup [options]
```

Options:

```
-n, --dry-run    Show what would be copied; do not write
    --no-commit  Skip the auto-commit step
-h, --help       Show usage
```

If `$BACKUPS_HOME` is a git repo, each run that actually changes a
file auto-commits with a timestamped message — gives you a local-only
point-in-time history without timestamped folders.

#### Configuring the backup set

`config/backup.sh` is gitignored so your personal list stays out of
the repo. Copy the template and edit:

```sh
cp config/backup.sh.example config/backup.sh
$EDITOR config/backup.sh
```

Each entry is `"<source><TAB><dest under $BACKUPS_HOME>"`. Use a real
tab between the two fields. Bash's `$'\t'` makes the tab explicit:

```sh
BACKUP_ITEMS=(
    "$HOME/.zshrc"$'\t'"dotfiles/zshrc"
    "$HOME/.gitconfig"$'\t'"dotfiles/gitconfig"
)
```

---

### dns-test

Compare DNS resolver latency across a few paths — System DNS, a LAN
AdGuard resolver, Cloudflare 1.1.1.1, and Cloudflare DoH. Reports
avg/min/p50/p95/max plus the delta against a baseline.

```
dns-test [-d domain] [-n runs] [-a adguard_ip] [-b baseline]
```

Adding a path is one line in the `paths=( ... )` table inside the
script — `"Label|sampler|arg"` where the sampler is `sample_dig` or
`sample_doh`. Adding DoT is a matter of writing a `sample_dot` that
shells out to `kdig +tls`.

---

## Finder integration (optional)

The intended pattern is to wrap `encrypt` / `open-age` / `decrypt` in
small Automator workflows so you can right-click → encrypt or
double-click a `.age` file:

1. **Automator → New → Quick Action** (for the right-click menu) or
   **Application** (for double-click default opener).
2. Workflow receives **files or folders** in **Finder**.
3. Add a **Run Shell Script** action, shell `/bin/zsh`, pass input as
   **arguments**:

   ```sh
   # Quick Actions run with a minimal env — re-export your layout vars
   # here, or source ~/.zshrc with care.
   export TOOLS_HOME="$HOME/code/tools"
   export KEYS_HOME="$HOME/code/keys"
   export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

   for f in "$@"; do
       "$TOOLS_HOME/encrypt" "$f" >/dev/null 2>&1 || \
           osascript -e "display notification \"failed: $f\" with title \"Encrypt\""
   done
   osascript -e 'display notification "done" with title "Encrypt"'
   ```

4. Save. The Quick Action shows up in Finder's right-click menu under
   *Quick Actions*. Bind a keyboard shortcut in **System Settings →
   Keyboard → Keyboard Shortcuts → Services → Files and Folders**.

5. For double-click on `.age`: save the workflow as an **Application**
   instead, then `duti -s <bundle-id> .age all` (Automator apps get a
   bundle id like `com.apple.automator.<app-name>`).

The `.app` / `.workflow` bundles themselves are intentionally not
tracked in this repo — they're macOS binary plists with localization
data and personal paths baked in. Build your own from the snippet
above.

---

## Related: vault pre-commit hook

If you use `git-crypt` in your vault repo, a pre-commit hook that
runs `git-crypt status -f` catches accidentally-unencrypted files
before they hit history. That hook lives in the vault repo itself,
not here. After cloning the vault:

```sh
git config core.hooksPath .githooks
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

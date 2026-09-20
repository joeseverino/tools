# shellcheck shell=bash
# crypt.sh — defaults for encrypt / decrypt.
#
# Derives from KEYS_HOME exported by ~/.zshrc. No duplicated paths —
# single source of truth lives in the shell config.
#
# The private key is vault-backed. It is NOT kept on disk: lib/key.sh resolves
# AGE_KEY_ID through the local secret registry (config/secrets.json), reads the
# key from 1Password at unlock time, materializes it mode 600 for the life of
# the process, and unlinks it on exit. AGE_KEY stays the on-disk fallback — for
# a machine with no registry, a recovery shell, and the path the bats suite
# writes its throwaway key to.
#
# Resolution order for the private key:
#   1. AGE_KEY_REF, if set   (empty value pins "no reference" → force the file)
#   2. AGE_KEY_ID via the registry
#   3. AGE_KEY on disk
#
# Per-invocation override: AGE_PUBKEY / AGE_KEY / AGE_KEY_REF, or -k flag.

: "${KEYS_HOME:?set in ~/.zshrc}"
: "${AGE_PUBKEY:=$KEYS_HOME/file_key/file_key.pub}"
: "${AGE_KEY:=$KEYS_HOME/file_key/file_key}"
: "${AGE_KEY_ID:=crypt.file_key}"

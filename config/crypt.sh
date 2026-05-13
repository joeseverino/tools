# crypt.sh — defaults for encrypt / decrypt.
#
# Derives from KEYS_HOME exported by ~/.zshrc. No duplicated paths —
# single source of truth lives in the shell config.
#
# Per-invocation override: AGE_PUBKEY / AGE_KEY env vars, or -k flag.

: "${KEYS_HOME:?set in ~/.zshrc}"
: "${AGE_PUBKEY:=$KEYS_HOME/file_key/file_key.pub}"
: "${AGE_KEY:=$KEYS_HOME/file_key/file_key}"

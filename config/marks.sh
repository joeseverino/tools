# shellcheck shell=bash
# marks.sh — defaults for the Safari bookmarks tool.
#
# Safari's own iCloud-synced plist is the read-only source of truth; the
# derived notes live in the Life vault's Bookmarks/ folder. Everything is
# per-invocation overridable (the bats suite points all three at a tmpdir).

: "${LIFE_HOME:=$HOME/Documents/Life}"
: "${MARKS_DIR:=$LIFE_HOME/Bookmarks}"
: "${MARKS_PLIST:=$HOME/Library/Safari/Bookmarks.plist}"
: "${MARKS_STATE:=${XDG_STATE_HOME:-$HOME/.local/state}/severino-tools/marks-sync.json}"

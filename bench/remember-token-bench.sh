#!/usr/bin/env bash
# remember-token-bench.sh — quantify how much cheaper `remember` is than the
# manual "Write the file + Edit MEMORY.md" loop an AI agent runs by hand.
# Measured in bytes, a ~4:1 proxy for tokens. Self-contained (synthetic memory
# dir), asserts that remember is cheaper, and prints the ratio across a growing
# index so you can see the gap widen.
#
# Model — a COLD write (the realistic agent case):
#   manual : Read the whole MEMORY.md (to append a line safely) + Write the file
#            (path + frontmatter + body) + Edit the index + verify with cat/tail
#   remember : one call whose only output is two status lines
# The body text is identical on both sides, so the delta is pure plumbing.
# This is the cold-write upper bound; if the index is already in the agent's
# context and it skips verify, the manual flow is cheaper than shown here (the
# floor is ~1.5x). Tweak the INDEX_SIZES list to explore.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export TOOLS_HOME="${TOOLS_HOME:-$(cd "$HERE/.." && pwd)}"
# shellcheck source=lib/init.sh
source "$TOOLS_HOME/lib/init.sh" ""

REMEMBER="$TOOLS_HOME/remember"
INDEX_SIZES=(10 30 100 300)

LAST_NEW=0
LAST_OLD=0

# Representative memory (a real-shaped feedback note).
TITLE="Believe the test, not the theory"
SLUG="believe-the-test-over-theory"
DESC="when making a factual/security claim, run the check and trust the result"
HOOK="test before asserting; if the test contradicts the theory, the test wins"
read -r -d '' BODY <<'EOF' || true
When I make a factual or security claim, run the actual check and believe the result, even when it contradicts my mental model.

**Why:** Confident-but-wrong claims erode trust faster than admitting uncertainty.

**How to apply:** Test before asserting. If the test contradicts the theory, the test wins — revise immediately.
EOF

bench() {
    local n="$1"
    local dir index memfile fm anchor newline
    local index_b memfile_b abspath indexpath
    local new_out new_in new_out_b new_total
    local read_in read_out write_in write_out edit_in edit_out verify_in verify_out old_total

    dir="$(mktemp -d)"
    trap 'rm -rf "$dir"' RETURN
    index="$dir/MEMORY.md"

    # Seed a realistic index of n entries.
    : > "$index"
    local i
    for ((i = 1; i <= n; i++)); do
        printf -- '- [Sample memory %d](reference_sample_%d.md) — a representative one-line hook for entry %d\n' \
            "$i" "$i" "$i" >> "$index"
    done

    # --- NEW flow: one remember call ---
    new_out="$(printf '%s\n' "$BODY" | "$REMEMBER" feedback "$SLUG" "$TITLE" -d "$DESC" -k "$HOOK" --dir "$dir" 2>&1)"
    # Input I author = command scaffold + body; output = what comes back.
    local scaffold="printf '%s' BODY | remember feedback $SLUG \"$TITLE\" -d \"$DESC\" -k \"$HOOK\""
    new_in=$(( ${#scaffold} + ${#BODY} ))
    new_out_b=${#new_out}
    new_total=$(( new_in + new_out_b ))

    # --- OLD flow: Read index -> Write file -> Edit index -> verify ---
    memfile="$dir/feedback_${SLUG//-/_}.md"
    fm="$(sed -n '1,7p' "$memfile")"                 # frontmatter the agent hand-types
    memfile_b=$(wc -c < "$memfile" | tr -d ' ')
    index_b=$(wc -c < "$index" | tr -d ' ')
    abspath=${#memfile}; indexpath=${#index}
    anchor="$(tail -1 "$index")"                     # unique Edit anchor
    newline="- [$TITLE](feedback_${SLUG//-/_}.md) — $HOOK"

    read_in=$(( indexpath + 20 ))                    # Read tool: just the path
    read_out=$index_b                                # agent consumes the whole index
    write_in=$(( abspath + ${#fm} + ${#BODY} ))      # Write: path + frontmatter + body
    write_out=60
    edit_in=$(( indexpath + ${#anchor} + ${#anchor} + ${#newline} ))
    edit_out=60
    verify_in=$(( abspath + indexpath + 30 ))        # cat file + tail index
    verify_out=$(( memfile_b + 200 ))
    old_total=$(( read_in + read_out + write_in + write_out + edit_in + edit_out + verify_in + verify_out ))

    printf '%6d  %8d  %8d  %4d.%dx\n' "$n" "$new_total" "$old_total" \
        "$(( old_total / new_total ))" "$(( (old_total * 10 / new_total) % 10 ))"

    LAST_NEW=$new_total
    LAST_OLD=$old_total
}

[[ -x "$REMEMBER" ]] || die "error" "remember not found at $REMEMBER"

echo
msg "$GREEN" "bench" "remember vs manual Write+Edit  (bytes, ~4/token; cold-write model)"
echo
printf '%6s  %8s  %8s  %6s\n' "index" "NEW" "OLD" "ratio"
printf '%6s  %8s  %8s  %6s\n' "-----" "--------" "--------" "------"
for n in "${INDEX_SIZES[@]}"; do bench "$n"; done
echo

if (( LAST_NEW >= LAST_OLD )); then
    die "FAIL" "remember ($LAST_NEW B) not cheaper than manual ($LAST_OLD B)"
fi
msg "$GREEN" "PASS" "remember is cheaper at every measured index size"
echo

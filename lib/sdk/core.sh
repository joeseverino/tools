# shellcheck shell=bash
# Stable shell SDK core: presentation, errors, basic guards, and JSON scalars.
# shellcheck disable=SC2034 # Public color constants are consumed by callers.

if [[ -t 1 ]]; then
    BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
    GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'
else
    BOLD=''; DIM=''; RESET=''; GREEN=''; RED=''; YELLOW=''
fi

msg() { printf '  %s%-10s%s %s\n' "$1$BOLD" "$2" "$RESET" "$3"; }

die() {
    local label body code
    if (( $# >= 2 )); then label="$1"; body="$2"; code="${3:-1}"
    else label="error"; body="${1:-}"; code=1
    fi
    { echo; msg "$RED" "$label" "$body"; echo; } >&2
    exit "$code"
}

die_unknown() {
    local kind="$1" token="$2" sub="${3:-}"
    echo
    msg "$RED" "usage" "unknown $kind: $token"
    if [[ -n "$sub" ]]; then usage_command "$sub"; else usage; fi
    exit 2
}

header() {
    local s=""
    (( $2 == 1 )) || s="s"
    echo
    printf '  %s%s%s %d file%s\n' "$BOLD" "$1" "$RESET" "$2" "$s"
    echo
}

footer() {
    if (( $2 + $3 + $4 > 1 )); then
        echo
        printf '  %ssummary%s    %d %s, %d skipped, %d failed\n' \
            "$BOLD" "$RESET" "$2" "$1" "$3" "$4"
    fi
    echo
}

shebang_has() { head -1 "$2" 2>/dev/null | grep -q "$1"; }

require_files() {
    local label="$1" f; shift
    for f in "$@"; do [[ -f "$f" ]] || die "error" "$label not found: $f"; done
}

json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

json_bool() { if (( $1 )); then printf 'true'; else printf 'false'; fi; }

json_join() { local IFS=','; printf '%s' "$*"; }

# Versioned result envelope for lightweight scripts and agent utilities.
# data/details are pre-rendered JSON so callers never lose structured values.
result_ok() {
    local data="${1:-null}"
    printf '{"ok":true,"result_version":1,"data":%s,"warnings":[],"receipt":null,"next":[]}\n' "$data"
}

result_error() {
    local code="$1" message="$2" retryable="${3:-0}" details="${4:-}"
    printf '{"ok":false,"result_version":1,"error":{"code":"%s","message":"%s","retryable":%s' \
        "$(json_escape "$code")" "$(json_escape "$message")" "$(json_bool "$retryable")"
    [[ -n "$details" ]] && printf ',"details":%s' "$details"
    printf '}}\n'
}

age_reason() { echo "$1" | head -1 | sed 's/^age: error: //'; }

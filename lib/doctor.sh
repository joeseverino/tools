# shellcheck shell=bash
# doctor.sh — shared doctor/gate plumbing for the personal CLI tools.
#
# One home for three things every health surface needs:
#
#   check / check_warn   record one named result (text line or JSON entry)
#   gate                 run another system's own gate (exit code = contract),
#                        timed, output tail shown on failure
#   doctor_finish        render the run's verdict + JSON, return the exit code
#
# The cross-system rollup (`tools doctor --all`) is just the gate registry
# below. Each system keeps its own gate and its own detail; the only contract
# a gate must honor is "exit 0 when healthy" — no per-tool --json needed.
# Sourced after lib/common.sh (msg/colors/json_* helpers).

# check / check_warn collect into DOCTOR_CHECKS when --json is active,
# print colored lines otherwise. A warn never fails the run.
DOCTOR_JSON=0
DOCTOR_CHECKS=()

check() {
    local label="$1" ok="$2" detail="${3:-}"
    if (( DOCTOR_JSON )); then
        DOCTOR_CHECKS+=("{\"label\":\"$(json_escape "$label")\",\"ok\":$(json_bool "$ok"),\"detail\":\"$(json_escape "$detail")\"}")
        (( ok )) && return 0 || return 1
    fi
    if (( ok )); then
        msg "$GREEN" "ok" "$label${detail:+ ${DIM}($detail)${RESET}}"
        return 0
    else
        msg "$RED" "missing" "$label${detail:+ ${DIM}($detail)${RESET}}"
        return 1
    fi
}

check_warn() {
    local label="$1" detail="${2:-}"
    if (( DOCTOR_JSON )); then
        DOCTOR_CHECKS+=("{\"label\":\"$(json_escape "$label")\",\"ok\":true,\"warning\":true,\"detail\":\"$(json_escape "$detail")\"}")
        return 0
    fi
    msg "$YELLOW" "warn" "$label${detail:+ ${DIM}($detail)${RESET}}"
}

# gate <label> <command>... — run one system gate, record pass/fail with the
# duration. On failure the detail carries the gate's last output line and the
# text mode prints the tail, so the cause is visible without a re-run.
gate() {
    local label="$1"; shift
    local start out rc=0 secs last
    start=$SECONDS
    out=$("$@" 2>&1) || rc=$?
    secs=$(( SECONDS - start ))
    if (( rc == 0 )); then
        check "$label" 1 "${secs}s"
        return 0
    fi
    last="$(printf '%s\n' "$out" | sed -e 's/^[[:space:]]*//' -e '/^$/d' | tail -1)"
    check "$label" 0 "exit $rc in ${secs}s — $last" || true
    if (( ! DOCTOR_JSON )); then
        printf '%s\n' "$out" | tail -n 6 | while IFS= read -r line; do
            printf '             %s%s%s\n' "$DIM" "$line" "$RESET"
        done
    fi
    return 1
}

# The gate registry — the one place that defines what "every system" means.
# Adding a gate here adds it to `tools doctor --all` (and its --json).
doctor_gates() {
    local fail=0
    gate "hq doctor"   "$TOOLS_HOME/bin/hq" doctor         || fail=1
    gate "hq schema"   "$TOOLS_HOME/bin/hq" schema --check || fail=1
    gate "site doctor" "$TOOLS_HOME/bin/site" doctor       || fail=1
    return "$fail"
}

# Live gates — drift guards hit real APIs (network + age key), so they only
# run when explicitly asked for (`tools doctor --live`).
doctor_live_gates() {
    local fail=0
    gate "cf-dns drift"  "$TOOLS_HOME/bin/cf-dns"  diff || fail=1
    gate "adguard drift" "$TOOLS_HOME/bin/adguard" diff || fail=1
    gate "ts-acl drift"  "$TOOLS_HOME/bin/ts-acl"  diff || fail=1
    return "$fail"
}

# doctor_finish <fail> — one JSON object or the colored verdict; returns
# the run's exit code.
doctor_finish() {
    local fail="$1"
    if (( DOCTOR_JSON )); then
        local ok=1; (( fail )) && ok=0
        printf '{"ok":%s,"checks":[%s]}\n' "$(json_bool "$ok")" "$(json_join "${DOCTOR_CHECKS[@]}")"
        return "$fail"
    fi
    echo
    if (( fail )); then
        printf '  %sdoctor%s    one or more checks failed\n\n' "$BOLD$RED" "$RESET"
        return 1
    fi
    printf '  %sdoctor%s    all checks passed\n\n' "$BOLD$GREEN" "$RESET"
}

#!/usr/bin/env bats
# brief-tui.bats — the workspace cockpit. The cockpit is a pure renderer over
# `brief --json --prs`, so a tiny BRIEF_BIN stub emitting a canned digest exercises
# the ranking, the loop-verb actions, copy/run/open, and the help overlay with no
# repos / vault / gh / network at all. Mirrors repos-tui's SMOKE/REPLAY harness.
#
# Bats 1.13 gates only on a test's LAST command — multi-part checks are chained.

load helpers

tui() { node "$TOOLS_HOME/lib/brief/tui.mjs"; }

setup_digest() {
    export BRIEF_BIN="$BATS_TEST_TMPDIR/brief-stub"
    cat > "$BRIEF_BIN" <<'EOF'
#!/usr/bin/env bash
cat <<'JSON'
{"ok":true,
 "repos":{"count":5,"ship":["site","tools"],"resync":["hq"],"dirty":["site"],"attention":3,"by_pm":{"npm":2}},
 "vault":{"doc_count":138,"recent_changes":15,"docs_to_review":3,"docs_to_review_top":["rb-cert","rb-deploy"],"inbox":4},
 "writeups":{"drafts":["zero-trust"],"published":15,"featured":[]},
 "prs":[{"repo":"site","number":42,"ci":"passing","review":"approved","url":"https://github.com/joeseverino/site/pull/42"},
        {"repo":"tools","number":7,"ci":"failing","review":"review_required","url":"https://github.com/joeseverino/tools/pull/7"}]}
JSON
EOF
    chmod +x "$BRIEF_BIN"
}

@test "smoke: cockpit ranks one queue with the loop verbs" {
    setup_digest
    export BRIEF_TUI_SMOKE=1
    run tui
    [ "$status" -eq 0 ]
    grep -qF "brief tui" <<<"$output" \
      && grep -qF "land 'site' --go" <<<"$output" \
      && grep -qF "ship 'tools' --check --watch --go" <<<"$output" \
      && grep -qF "resync 'hq'" <<<"$output" \
      && grep -qF "land 'tools' --go --admin" <<<"$output"
}

@test "smoke: green PR lands above ship above resync (severity order)" {
    setup_digest
    export BRIEF_TUI_SMOKE=1
    run tui
    [ "$status" -eq 0 ]
    [ "$(grep -nF "land 'site'" <<<"$output" | cut -d: -f1)" \
        -lt "$(grep -nF "resync 'hq'" <<<"$output" | cut -d: -f1)" ]
}

@test "replay: x runs the top action (land the green PR)" {
    setup_digest
    export BRIEF_TUI_KEYS='x'
    run tui
    [ "$status" -eq 0 ]
    grep -qF "would run land: land 'site' --go" <<<"$output"
}

@test "replay: down then enter copies the ship command" {
    setup_digest
    export BRIEF_TUI_KEYS='down,enter'
    run tui
    [ "$status" -eq 0 ]
    grep -qF "copied ship: ship 'site' --check --watch --go" <<<"$output"
}

@test "replay: o opens the selected PR on GitHub" {
    setup_digest
    export BRIEF_TUI_KEYS='o'
    run tui
    [ "$status" -eq 0 ]
    grep -qF "would run open GitHub: open -a Safari 'https://github.com/joeseverino/site/pull/42'" <<<"$output"
}

@test "replay: ? opens the help overlay" {
    setup_digest
    export BRIEF_TUI_KEYS='?'
    run tui
    [ "$status" -eq 0 ]
    grep -qF "run the selected action" <<<"$output" && grep -qF "Esc closes" <<<"$output"
}

@test "cockpit shows all-clear when nothing needs you" {
    export BRIEF_BIN="$BATS_TEST_TMPDIR/empty"
    printf '#!/usr/bin/env bash\necho %s\n' \
      "'{\"ok\":true,\"repos\":{\"count\":0,\"ship\":[],\"resync\":[]},\"vault\":{},\"writeups\":{},\"prs\":[]}'" > "$BRIEF_BIN"
    chmod +x "$BRIEF_BIN"
    export BRIEF_TUI_SMOKE=1
    run tui
    [ "$status" -eq 0 ]
    grep -qF "all clear" <<<"$output"
}

@test "brief tui refuses without a terminal" {
    setup_digest
    run tui
    [ "$status" -eq 1 ]
    grep -qF "needs a terminal" <<<"$output" && grep -qF "brief --json" <<<"$output"
}

@test "brief describe exposes tui as remote_write+network+interactive" {
    run "$TOOLS_HOME/bin/brief" --describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
t={c["name"]: c for c in json.load(sys.stdin)["commands"]}["tui"]
assert t["effect"]=="remote_write", t["effect"]
assert t["network"] is True and t["interactive"] is True
'
}

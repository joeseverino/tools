#!/usr/bin/env bats
# lib/hq-call: the operator's transport to HQ's tools over the host shell.

setup() {
    export TEST_BIN="$BATS_TEST_TMPDIR/bin"
    export SSH_LOG="$BATS_TEST_TMPDIR/ssh"
    mkdir -p "$TEST_BIN"
    cat > "$TEST_BIN/ssh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SSH_LOG.args"
cat > "$SSH_LOG.stdin"
printf '%s\n' '{"ok":true}'
SH
    chmod +x "$TEST_BIN/ssh"
    export PATH="$TEST_BIN:$PATH"
    CALL="$BATS_TEST_DIRNAME/../lib/hq-call"
}

@test "hq-call: forwards the request to hq_call in the container on the host" {
    HQ_SSH_HOST=example-host run bash -c "printf '%s' '{\"tool\":\"audit_registry\"}' | '$CALL'"
    [ "$status" -eq 0 ]
    [ "$output" = '{"ok":true}' ]
    [ "$(sed -n 1p "$SSH_LOG.args")" = "example-host" ]
    [ "$(sed -n 2p "$SSH_LOG.args")" = "sudo docker exec -i severino-hq python manage.py hq_call" ]
    [ "$(cat "$SSH_LOG.stdin")" = '{"tool":"audit_registry"}' ]
}

@test "hq-call: a container override is used" {
    HQ_SSH_HOST=example-host HQ_CONTAINER=hq-staging run "$CALL" </dev/null
    [ "$status" -eq 0 ]
    [ "$(sed -n 2p "$SSH_LOG.args")" = "sudo docker exec -i hq-staging python manage.py hq_call" ]
}

@test "hq-call: a container name that could reach the remote shell is refused" {
    for name in 'x; rm -rf /' '$(id)' 'a b' '-x' ''; do
        HQ_SSH_HOST=example-host HQ_CONTAINER="$name" run "$CALL" </dev/null
        if [ -n "$name" ]; then [ "$status" -eq 2 ]; fi
    done
    [ ! -e "$SSH_LOG.args" ] || [ "$(sed -n 2p "$SSH_LOG.args")" = "sudo docker exec -i severino-hq python manage.py hq_call" ]
}

@test "hq-call: without a host it refuses rather than guessing" {
    HQ_SSH_HOST= run "$CALL" </dev/null
    [ "$status" -ne 0 ]
    [ ! -e "$SSH_LOG.args" ]
}

# ---- hq call / hq drift, through a stubbed transport -------------------------

# fake_call <file> — an HQ_CALL transport that records the request and answers
# with the file's contents.
fake_call() {
    export HQ_CALL="$BATS_TEST_TMPDIR/call" HQ_REQUEST="$BATS_TEST_TMPDIR/request"
    printf '#!/usr/bin/env bash\ncat > "$HQ_REQUEST"\ncat %q\n' "$1" > "$HQ_CALL"
    chmod +x "$HQ_CALL"
}

hq_bin() { NOTES_HOME="$BATS_TEST_TMPDIR" "$BATS_TEST_DIRNAME/../bin/hq" "$@"; }

resources() {
    cat > "$BATS_TEST_TMPDIR/resources.json" <<'JSON'
{"count":4,"items":[
 {"key":"edge","kind":"machine","enabled":true,"in_sync":false,"generation":1,"observed_generation":0,"health":{"state":"declared","label":"Recorded"}},
 {"key":"dns","kind":"adguard.rewrite","enabled":true,"in_sync":true,"generation":1,"observed_generation":1,"health":{"state":"healthy","label":"Healthy"}},
 {"key":"off","kind":"caddy.route","enabled":false,"in_sync":false,"generation":2,"observed_generation":1,"health":{"state":"healthy","label":"Healthy"}},
 {"key":"app","kind":"portainer.container","enabled":true,"in_sync":"__SYNC__","generation":4,"observed_generation":2,"health":{"state":"healthy","label":"Healthy"}}]}
JSON
    sed -i '' "s/\"__SYNC__\"/$1/" "$BATS_TEST_TMPDIR/resources.json"
}

@test "hq call: sends the MCP tool contract and prints the tool's result" {
    printf '{"ok":true}\n' > "$BATS_TEST_TMPDIR/answer.json"
    fake_call "$BATS_TEST_TMPDIR/answer.json"
    run hq_bin call list_managed_resources '{"limit":2}'
    [ "$status" -eq 0 ]
    [ "$output" = '{"ok":true}' ]
    [ "$(cat "$HQ_REQUEST")" = '{"tool":"list_managed_resources","arguments":{"limit":2}}' ]
}

@test "hq call: no arguments sends an empty arguments object" {
    printf '{"ok":true}\n' > "$BATS_TEST_TMPDIR/answer.json"
    fake_call "$BATS_TEST_TMPDIR/answer.json"
    run hq_bin call describe_capabilities
    [ "$status" -eq 0 ]
    [ "$(cat "$HQ_REQUEST")" = '{"tool":"describe_capabilities","arguments":{}}' ]
}

@test "hq call: a tool name or argument that is not plain is refused before sending" {
    printf '{}\n' > "$BATS_TEST_TMPDIR/answer.json"
    fake_call "$BATS_TEST_TMPDIR/answer.json"
    run hq_bin call 'x;id'
    [ "$status" -eq 2 ]
    run hq_bin call audit_registry '[1]'
    [ "$status" -eq 2 ]
    [ ! -e "$HQ_REQUEST" ]
}

@test "hq drift: declared records and disabled resources never count; a moved declaration does" {
    resources false
    fake_call "$BATS_TEST_TMPDIR/resources.json"
    run hq_bin drift --json
    [ "$status" -eq 1 ]
    OUTPUT="$output" python3 - <<'PY'
import json, os
d = json.loads(os.environ["OUTPUT"])
assert [r["key"] for r in d] == ["app"], d
assert d[0]["reason"] == "declared generation 4, last applied 2"
PY
}

@test "hq drift: exits 0 when everything HQ reconciles is in sync" {
    resources true
    fake_call "$BATS_TEST_TMPDIR/resources.json"
    run hq_bin drift
    [ "$status" -eq 0 ]
    [[ "$output" == *"in sync (2 checked)"* ]]
}

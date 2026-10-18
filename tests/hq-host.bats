#!/usr/bin/env bats
# hq's host commands: HQ runs as one container under systemd, so they reach it
# through its unit, its journal and docker exec -- never docker compose.

load helpers

setup() {
    export TEST_BIN="$BATS_TEST_TMPDIR/bin"
    export SSH_LOG="$BATS_TEST_TMPDIR/ssh"
    mkdir -p "$TEST_BIN"
    cat > "$TEST_BIN/ssh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SSH_LOG.args"
cat > "$SSH_LOG.stdin"
SH
    chmod +x "$TEST_BIN/ssh"
    export PATH="$TEST_BIN:$PATH"
}

hq_bin() {
    NOTES_HOME="$BATS_TEST_TMPDIR" HQ_URL="https://hq.example.test" HQ_SSH_HOST=example-host \
        "$BATS_TEST_DIRNAME/../bin/hq" "$@" </dev/null
}

# The remote command line: ssh's last argument.
remote() { tail -n 1 "$SSH_LOG.args"; }

@test "hq logs: reads the web unit's journal" {
    run hq_bin logs --tail 20
    [ "$status" -eq 0 ]
    [ "$(sed -n 1p "$SSH_LOG.args")" = "example-host" ]
    [ "$(remote)" = "sudo journalctl -u severino-hq-web.service --no-pager -n 20" ]
}

@test "hq logs: --follow streams the journal over a TTY" {
    run hq_bin logs -f
    [ "$status" -eq 0 ]
    [ "$(sed -n 1p "$SSH_LOG.args")" = "-t" ]
    [ "$(remote)" = "sudo journalctl -u severino-hq-web.service --no-pager -f" ]
}

@test "hq logs: a --tail that is not a number never reaches the remote shell" {
    run hq_bin logs --tail '5; id'
    [ "$status" -eq 2 ]
    [ ! -e "$SSH_LOG.args" ]
}

@test "hq restart: restarts the web unit through systemd" {
    TOOLS_ASSUME_YES=1 run hq_bin restart
    [ "$status" -eq 0 ]
    [ "$(remote)" = "sudo systemctl restart severino-hq-web.service" ]
    [[ "$output" == *"healthy"* ]]
}

@test "hq shell and superuser: manage.py in the running container" {
    run hq_bin shell
    [ "$status" -eq 0 ]
    [ "$(sed -n 1p "$SSH_LOG.args")" = "-t" ]
    [ "$(remote)" = "sudo docker exec -it severino-hq python manage.py shell" ]
    HQ_CONTAINER=hq-staging run hq_bin superuser
    [ "$status" -eq 0 ]
    [ "$(remote)" = "sudo docker exec -it hq-staging python manage.py createsuperuser" ]
}

@test "hq shell: a container name that could reach the remote shell is refused" {
    HQ_CONTAINER='x; id' run hq_bin shell
    [ "$status" -eq 2 ]
    [ ! -e "$SSH_LOG.args" ]
}

@test "hq life-sync: pipes the snapshot to ingest_life_snapshot in the container" {
    cat > "$TEST_BIN/life" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"schema_version":1,"content_hash":"abc","data":{"renewals":[{"doc_id":"r1"}]}}'
SH
    chmod +x "$TEST_BIN/life"
    run hq_bin life-sync
    [ "$status" -eq 0 ]
    [ "$(remote)" = "sudo docker exec -i severino-hq python manage.py ingest_life_snapshot" ]
    [[ "$(cat "$SSH_LOG.stdin")" == *'"content_hash":"abc"'* ]]
}

@test "hq: no host command runs docker compose" {
    ! grep -rn 'docker compose' "$BATS_TEST_DIRNAME/../lib/hq"
}

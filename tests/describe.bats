#!/usr/bin/env bats
# describe.bats — the emit-once command-surface contract (lib/describe.sh) and
# the `tools describe` aggregator. The load-bearing test is the round-trip
# invariant: because -h and --describe both render from one describe_spec, the
# set of options/commands in the rendered usage must equal the set in the JSON.

load helpers

# Run a synthetic describe_spec through the engine and capture either the JSON
# (mode=json) or the usage text (mode=usage). Keeps the spec in one place so the
# two renderers are exercised from identical input.
# render <mode> [command]
#   json            → the --describe JSON
#   usage           → the main human help
#   usage <command> → the focused per-command help (usage_command)
render() {
    local mode="$1" cmd="${2:-}"
    bash -c '
        source "$TOOLS_HOME/lib/common.sh"
        source "$TOOLS_HOME/lib/describe.sh"
        describe_spec() {
            desc_tool "demo" "A demo tool."
            desc_synopsis "demo [options] <file>..."
            desc_para "First paragraph."
            desc_example "demo a.txt" -- "the common case"
            desc_opt -c --copy             -- "Keep the original"
            desc_opt -k --key PATH +repeat -- "Add a key (repeatable)"
            desc_opt --filter "{all,published,draft}" -- "Which items"
            desc_pos file +variadic        -- "File(s) to act on"
            desc_cmd run -- "Run it"
            desc_para "Detail about the run command."
            desc_opt --fast -- "Run faster"
            desc_pos target -- "What to run"
            desc_example "demo run thing" -- "a run example"
            desc_delegate "the owning repo (see its README)"
            desc_env DEMO_HOME -- "Where demo lives"
        }
        if [ "$1" = json ]; then describe_emit
        elif [ -n "$2" ]; then usage_command "$2"
        else usage; fi
    ' _ "$mode" "$cmd"
}

@test "describe_render_json emits the versioned contract envelope" {
    run render json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["ok"] is True
assert o["schema_version"] == 2
assert o["name"] == "demo"
assert o["description"] == "A demo tool."
for k in ("global_options","positionals","commands"):
    assert isinstance(o[k], list), k
'
}

@test "options carry flags / takes_value / repeatable / choices" {
    run render json
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
g={x["name"]:x for x in o["global_options"]}
assert g["--copy"]["flags"]==["-c","--copy"]
assert g["--copy"]["takes_value"] is False
assert g["--key"]["takes_value"] is True
assert g["--key"]["repeatable"] is True
assert g["--filter"]["choices"]==["all","published","draft"]
assert "repeatable" not in g["--copy"]
'
}

@test "JSON v2 carries scoped paras, examples, and delegation (agent-readable signals)" {
    run render json
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
# tool-level (global-scope) prose + examples
assert "First paragraph." in o["paras"], o["paras"]
assert any(e["command"]=="demo a.txt" and e["comment"]=="the common case" for e in o["examples"])
run={c["name"]:c for c in o["commands"]}["run"]
# command-scoped prose + examples ride under the command, not the tool
assert "Detail about the run command." in run["paras"]
assert "First paragraph." not in run["paras"]
assert any(e["command"]=="demo run thing" for e in run["examples"])
# delegation is structured, not prose
assert run["delegates"].startswith("the owning repo")
'
}

@test "a non-delegating command omits the delegates key (real tool: encrypt)" {
    setup_crypt
    run "$TOOLS_HOME/bin/encrypt" --describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
for c in o["commands"]:
    assert "delegates" not in c, c["name"]
'
}

@test "positionals map required/variadic; top-level vs command scope" {
    run render json
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
# top-level positional
p={x["name"]:x for x in o["positionals"]}
assert p["file"]["positional"] is True and p["file"]["required"] is True
# command + its scoped args
cmd={c["name"]:c for c in o["commands"]}
assert "run" in cmd
names={a["name"] for a in cmd["run"]["args"]}
assert "target" in names and "--fast" in names
'
}

@test "usage renders Usage/Commands/Options sections plus the implicit -h" {
    run render usage
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage: demo [options] <file>..."* ]]
    [[ "$output" == *"Commands:"* ]]
    [[ "$output" == *"run"* ]]
    [[ "$output" == *"-c, --copy"* ]]
    [[ "$output" == *"-h, --help"* ]]
    [[ "$output" == *"Environment:"* ]]
    [[ "$output" == *"Examples:"* ]]
}

@test "round-trip invariant: every JSON option/command appears in some help view" {
    json=$(render json)
    # The human surface is the main usage plus each command's focused help —
    # command options now live in `<tool> <cmd> -h`, not the main screen.
    help=$(render usage)
    cmds=$(printf '%s' "$json" | python3 -c '
import json,sys
for c in json.load(sys.stdin)["commands"]: print(c["name"])
')
    while IFS= read -r c; do
        [ -n "$c" ] || continue
        help+=$'\n'"$(render usage "$c")"
    done <<<"$cmds"

    # Collect every long flag and command name from the JSON contract.
    tokens=$(printf '%s' "$json" | python3 -c '
import json,sys
o=json.load(sys.stdin)
toks=set()
def opts(lst):
    for a in lst:
        for f in a.get("flags",[]):
            if f.startswith("--"): toks.add(f)
opts(o["global_options"])
for c in o["commands"]:
    toks.add(c["name"]); opts(c["args"])
print("\n".join(sorted(toks)))
')
    while IFS= read -r tok; do
        [ -n "$tok" ] || continue
        if [[ "$help" != *"$tok"* ]]; then
            echo "JSON token not present in any help view: $tok"
            return 1
        fi
    done <<<"$tokens"
}

@test "usage_command renders one command's options, args, prose, and examples" {
    run render usage run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage: demo run [options] <target>"* ]]
    [[ "$output" == *"Run it"* ]]
    [[ "$output" == *"Arguments:"* ]]
    [[ "$output" == *"target"* ]]
    [[ "$output" == *"--fast"* ]]
    [[ "$output" == *"-h, --help"* ]]
    # command-scoped prose + examples render in the command's focused help…
    [[ "$output" == *"Detail about the run command."* ]]
    [[ "$output" == *"Examples:"* ]]
    [[ "$output" == *"demo run thing"* ]]
    # …and the tool-level ones do NOT leak into a command's screen.
    [[ "$output" != *"First paragraph."* ]]
    [[ "$output" != *"demo a.txt"* ]]
}

@test "main usage stays a scannable command list with a focused-help pointer" {
    run render usage
    [ "$status" -eq 0 ]
    [[ "$output" == *"Commands:"* ]]
    [[ "$output" == *"run"* ]]
    # command-scoped detail is NOT inlined on the main screen…
    [[ "$output" != *"--fast"* ]]
    [[ "$output" != *"Detail about the run command."* ]]
    [[ "$output" != *"demo run thing"* ]]
    # …but the pointer to it is.
    [[ "$output" == *"demo <command> -h"* ]]
    # tool-level prose + examples DO show on the main screen.
    [[ "$output" == *"First paragraph."* ]]
    [[ "$output" == *"demo a.txt"* ]]
}

@test "engine is byte-identical under bash and zsh" {
    spec='
        source "$TOOLS_HOME/lib/common.sh"; source "$TOOLS_HOME/lib/describe.sh"
        describe_spec(){ desc_tool t d; desc_opt -d X -- h; desc_cmd c -- s; desc_opt --foo "{a,b}" -- hh; }
        describe_emit'
    bash_out=$(bash -c "$spec")
    if command -v zsh >/dev/null 2>&1; then
        zsh_out=$(zsh -c "$spec")
        [ "$bash_out" = "$zsh_out" ]
    else
        skip "zsh not installed"
    fi
}

@test "a real tool self-describes (encrypt)" {
    setup_crypt
    run "$TOOLS_HOME/bin/encrypt" --describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["ok"] is True and o["name"]=="encrypt"
names={a["name"] for a in o["global_options"]}
assert "--copy" in names and "--key" in names
'
}

@test "tools describe aggregates every bin/ tool, deterministically" {
    setup_crypt
    run "$TOOLS_HOME/bin/tools" describe
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c '
import json,sys
o=json.load(sys.stdin)
assert o["ok"] is True and o["repo"]=="tools"
names=[t["name"] for t in o["tools"]]
# every executable in bin/ is represented exactly once
import os
binset={f for f in os.listdir(os.path.join(os.environ["TOOLS_HOME"],"bin"))}
assert binset == set(names), (binset ^ set(names))
'
    run2="$("$TOOLS_HOME/bin/tools" describe)"
    [ "$output" = "$run2" ]
}

@test "every tool answers -h and --help identically (one renderer, both flags routed)" {
    # The help text is rendered by one shared engine (lib/describe.sh); the only
    # per-tool code is the dispatch line that routes the flag to it. This guards
    # that BOTH -h and --help reach that renderer for every tool — a regression
    # where a shared dispatcher (lib/drift.sh) matched -h but not --help shipped
    # "unknown command: --help" on the drift guards.
    setup_crypt
    for tool in "$TOOLS_HOME"/bin/*; do
        h_out="$("$tool" -h 2>&1)"; h_rc=$?
        hh_out="$("$tool" --help 2>&1)"; hh_rc=$?
        [ "$h_rc" -eq 0 ] || { echo "$(basename "$tool"): -h exited $h_rc"; return 1; }
        [ "$hh_rc" -eq 0 ] || { echo "$(basename "$tool"): --help exited $hh_rc"; return 1; }
        [ "$h_out" = "$hh_out" ] || { echo "$(basename "$tool"): -h and --help differ"; return 1; }
    done
}

@test "subcommand -h renders focused help from the spec, never runs the command" {
    # `<tool> <cmd> -h` must route to usage_command (the same renderer the main
    # screen uses) and return before any action — a help flag that fell through
    # to `pull` would hit the network. Drift guards share one dispatcher
    # (lib/drift.sh), so this covers adguard / ts-acl / cf-dns / nginx at once.
    run "$TOOLS_HOME/bin/adguard" pull -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage: adguard pull"* ]]
    [[ "$output" == *"Regenerate the vault mirror block"* ]]
    [[ "$output" == *"-h, --help"* ]]
    # --help is the same render as -h here too.
    run "$TOOLS_HOME/bin/adguard" diff --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage: adguard diff"* ]]
}

@test "spec ↔ dispatch parity is exact, both directions (no orphan command or arm)" {
    # The spec (describe_spec) is the command-surface DATA; the dispatch `case`
    # is the behavior wiring (which differs per command — cmd_*, run_npm, aliases
    # — so it can't be derived). The only shared token is the command name. This
    # asserts the two sets are EQUAL: a desc_cmd with no dispatch arm (shows in
    # help, errors on run) AND a dispatch arm with no desc_cmd (an undisclosed
    # command) both fail. The arm set is the `case` block right after
    # desc_help_intercept. Drift guards dispatch in lib/drift.sh (show/diff/pull),
    # covered by drift.bats instead.
    setup_crypt
    for tool in hq site tools brand vault; do
        run python3 - "$TOOLS_HOME/bin/$tool" <<'PY'
import json, os, re, subprocess, sys
path = sys.argv[1]
src = open(path).read()
spec = {c["name"] for c in
        json.loads(subprocess.run([path, "--describe"], capture_output=True, text=True).stdout)["commands"]}
block = src[src.index('desc_help_intercept "$@"'):].split("\nesac", 1)[0]
arms = set(re.findall(r'^\s*([a-z][a-z0-9-]*)\)\s', block, re.M))
if spec != arms:
    print(f"{os.path.basename(path)}: spec-only={sorted(spec-arms)} arm-only={sorted(arms-spec)}")
    sys.exit(1)
PY
        [ "$status" -eq 0 ] || { echo "$output"; return 1; }
    done
}

@test "every declared flag is referenced in the parser (spec can't run ahead of code)" {
    # describe_spec is the documentation source; each handler still parses argv
    # separately, so the two CAN drift. This is the cheap guard for the common
    # direction: a desc_opt long flag that no parser handles. (The reverse — a
    # parser flag missing from the spec — and full behavioral SOT would need the
    # parser generated from the spec; that's the remaining known gap.)
    setup_crypt
    for t in "$TOOLS_HOME"/bin/*; do
        head -1 "$t" | grep -q node && continue   # doc-to-pdf carries its own SPEC
        flags=$("$t" --describe 2>/dev/null | python3 -c '
import json,sys
try: o=json.load(sys.stdin)
except Exception: sys.exit(0)
fl=set()
def go(a):
    for x in a:
        for f in x.get("flags",[]):
            if f.startswith("--"): fl.add(f)
go(o.get("global_options",[]))
for c in o.get("commands",[]): go(c.get("args",[]))
print("\n".join(sorted(fl)))' 2>/dev/null)
        while IFS= read -r f; do
            [ -n "$f" ] || continue
            grep -qF -- "$f" "$t" \
                || { echo "$(basename "$t"): declares $f but the parser never references it"; return 1; }
        done <<<"$flags"
    done
}

@test "tools describe <tool> delegates to that tool" {
    setup_crypt
    run "$TOOLS_HOME/bin/tools" describe encrypt
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c 'import json,sys; assert json.load(sys.stdin)["name"]=="encrypt"'
}

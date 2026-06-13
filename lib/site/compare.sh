# shellcheck shell=bash
# `site compare` lifecycle and argument handling.

cmd_compare() {
    local path="/" should_open="1" use_http="" notes_out="" clear_notes=""
    local mode="" compact="" link_scroll="" scroll_mode="" mirror_links="" notes_open="" split="" swap="" solo="" focus="" overlay="" overlay_blend=""
    local -a review_notes=()
    local dev_url="http://$SITE_DEV_HOST:$SITE_DEV_PORT"
    local live_url="${SITE_LIVE_URL:-https://jseverino.com}"
    local compare_host="${SITE_COMPARE_HOST:-127.0.0.1}"
    local compare_port="${SITE_COMPARE_PORT:-4178}"
    local compare_brand="${SITE_COMPARE_BRAND:-Joe Severino}"
    local notes_file="${SITE_COMPARE_NOTES:-${TMPDIR:-/tmp}/sitedrift-notes.json}"
    local vault_dir="${SITE_COMPARE_VAULT:-}"
    if [[ -z "$vault_dir" ]]; then
        if [[ -d "$NOTES_HOME/00 Inbox" ]]; then vault_dir="$NOTES_HOME/00 Inbox"
        elif [[ -d "$NOTES_HOME" ]]; then vault_dir="$NOTES_HOME"; fi
    fi
    local compare_url health_url log_file pid_file launch_label node_path session_file
    local cert_dir cert_file key_file compare_name
    compare_name="${SITE_COMPARE_NAME:-compare.homelab}"
    cert_dir="${SITE_COMPARE_CERT_DIR:-$HOME/Documents/Code/Assets/PKI/Issued Certificates/$compare_name}"
    cert_file="$cert_dir/fullchain.pem"
    key_file="$cert_dir/$compare_name.key"
    compare_url="https://$compare_name:$compare_port"
    health_url="https://$compare_name:$compare_port"
    log_file="${TMPDIR:-/tmp}/site-compare.log"
    pid_file="${TMPDIR:-/tmp}/site-compare.pid"
    session_file="$HOME/.sitedrift/sessions/$compare_port.json"
    launch_label="com.severino.site-compare.$compare_port"
    node_path="$(command -v node)"
    local sitedrift_entry
    sitedrift_entry="${SITEDRIFT_ENTRY:-$HOME/Documents/Code/Projects/sitedrift/sitedrift.mjs}"
    [[ -f "$sitedrift_entry" ]] \
        || die "error" "sitedrift not found at $sitedrift_entry — clone it there or set SITEDRIFT_ENTRY"

    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            --dev) [[ "$#" -ge 2 ]] || die "usage" "--dev requires a URL"; dev_url="$2"; shift 2 ;;
            --live) [[ "$#" -ge 2 ]] || die "usage" "--live requires a URL"; live_url="$2"; shift 2 ;;
            --mobile) mode="mobile"; shift ;;
            --desktop) mode="desktop"; shift ;;
            --compact) compact="1"; shift ;;
            --expanded) compact="0"; shift ;;
            --link-scroll) link_scroll="1"; shift ;;
            --no-link-scroll) link_scroll="0"; shift ;;
            --scroll-mode)
                [[ "$#" -ge 2 && ( "$2" == "exact" || "$2" == "ratio" ) ]] \
                    || die "usage" "--scroll-mode requires exact or ratio"
                scroll_mode="$2"
                shift 2
                ;;
            --mirror-links) mirror_links="1"; shift ;;
            --no-mirror-links) mirror_links="0"; shift ;;
            --notes) notes_open="1"; shift ;;
            --note) [[ "$#" -ge 2 ]] || die "usage" "--note requires text"; review_notes+=("$2"); shift 2 ;;
            --split)
                [[ "$#" -ge 2 && "$2" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "usage" "--split requires a number from 15 to 85"
                split="$2"
                awk -v value="$split" 'BEGIN { exit !(value >= 15 && value <= 85) }' \
                    || die "usage" "--split requires a number from 15 to 85"
                shift 2
                ;;
            --swap) swap="1"; shift ;;
            --solo) solo="1"; shift ;;
            --split-view) solo="0"; shift ;;
            --overlay) overlay="1"; shift ;;
            --overlay-diff) overlay="1"; overlay_blend="difference"; shift ;;
            --http) use_http="1"; shift ;;
            --brand) [[ "$#" -ge 2 ]] || die "usage" "--brand requires text"; compare_brand="$2"; shift 2 ;;
            --notes-out) [[ "$#" -ge 2 ]] || die "usage" "--notes-out requires a file path"; notes_out="$2"; shift 2 ;;
            --clear-notes) clear_notes="1"; shift ;;
            --focus)
                [[ "$#" -ge 2 && ( "$2" == "dev" || "$2" == "live" ) ]] \
                    || die "usage" "--focus requires dev or live"
                focus="$2"
                shift 2
                ;;
            --no-open) should_open=""; shift ;;
            --*) die_unknown flag "$1" compare ;;
            *) path="$1"; shift ;;
        esac
    done

    [[ "$path" == /* ]] || path="/$path"
    [[ -x "$node_path" ]] || die "error" "node is required for site compare"

    local -a curl_ca=()
    if [[ -n "$use_http" ]]; then
        compare_url="http://$compare_host:$compare_port"
        health_url="http://$compare_host:$compare_port"
        cert_file=""
        key_file=""
    else
        [[ -f "$cert_file" ]] || die "error" "certificate missing: run \`cert-gen $compare_name\` first (or use --http)"
        [[ -f "$key_file" ]] || die "error" "private key missing: $key_file"
        curl_ca=(--cacert "$cert_file")
    fi

    local expected_health current_health="" viewer_version="28" viewer_module
    viewer_module="$(dirname "$sitedrift_entry")/src/viewer.mjs"
    if [[ -f "$viewer_module" ]]; then
        viewer_version="$(node -e 'const {pathToFileURL}=require("url"); import(pathToFileURL(process.argv[1])).then(({VIEWER_VERSION}) => process.stdout.write(String(VIEWER_VERSION)))' "$viewer_module")"
    fi
    expected_health="$(node -e 'process.stdout.write(JSON.stringify({dev:process.argv[1].replace(/\/$/, ""),live:process.argv[2].replace(/\/$/, ""),version:Number(process.argv[3])}))' "$dev_url" "$live_url" "$viewer_version")"
    current_health="$(curl --noproxy '*' -fsS ${curl_ca[@]+"${curl_ca[@]}"} "$health_url/health" 2>/dev/null || true)"

    if [[ -n "$current_health" && "$current_health" != "$expected_health" ]]; then
        if command -v launchctl >/dev/null 2>&1; then
            launchctl remove "$launch_label" 2>/dev/null || true
        fi
        if [[ -f "$pid_file" ]]; then
            local old_pid
            old_pid="$(cat "$pid_file")"
            if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
                kill "$old_pid"
                for _ in {1..20}; do
                    kill -0 "$old_pid" 2>/dev/null || break
                    sleep 0.05
                done
            fi
        fi
        current_health=""
    fi

    if [[ -z "$current_health" ]]; then
        if [[ "$(uname -s)" == "Darwin" ]] && command -v launchctl >/dev/null 2>&1; then
            launchctl remove "$launch_label" 2>/dev/null || true
            launchctl submit -l "$launch_label" -- \
                /usr/bin/env \
                SITE_COMPARE_HOST="$compare_host" \
                SITE_COMPARE_HOSTNAME="$compare_name" \
                SITE_COMPARE_PORT="$compare_port" \
                SITE_COMPARE_DEV="$dev_url" \
                SITE_COMPARE_LIVE="$live_url" \
                SITE_COMPARE_CERT="$cert_file" \
                SITE_COMPARE_KEY="$key_file" \
                SITE_COMPARE_BRAND="$compare_brand" \
                SITE_COMPARE_NOTES="$notes_file" \
                SITE_COMPARE_VAULT="$vault_dir" \
                "$node_path" "$sitedrift_entry"
        else
            SITE_COMPARE_HOST="$compare_host" \
            SITE_COMPARE_HOSTNAME="$compare_name" \
            SITE_COMPARE_PORT="$compare_port" \
            SITE_COMPARE_DEV="$dev_url" \
            SITE_COMPARE_LIVE="$live_url" \
            SITE_COMPARE_CERT="$cert_file" \
            SITE_COMPARE_KEY="$key_file" \
            SITE_COMPARE_BRAND="$compare_brand" \
            SITE_COMPARE_NOTES="$notes_file" \
            SITE_COMPARE_VAULT="$vault_dir" \
                nohup "$node_path" "$sitedrift_entry" >"$log_file" 2>&1 &
            echo "$!" > "$pid_file"
        fi

        local ready=""
        for _ in {1..100}; do
            if curl --noproxy '*' -fsS ${curl_ca[@]+"${curl_ca[@]}"} "$health_url/health" >/dev/null 2>&1; then
                ready="1"
                break
            fi
            sleep 0.1
        done
        [[ -n "$ready" ]] || die "error" "compare viewer failed to start (see $log_file)"
    fi

    local api_token=""
    if [[ -f "$session_file" ]]; then
        api_token="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).token || "")' "$session_file" 2>/dev/null || true)"
    fi
    [[ -n "$api_token" ]] || die "error" "compare session token missing: $session_file"

    if [[ -n "$clear_notes" ]]; then
        curl --noproxy '*' -fsS ${curl_ca[@]+"${curl_ca[@]}"} -X POST \
            -H "authorization: Bearer $api_token" -H 'content-type: application/json' \
            --data '{"op":"clear"}' "$health_url/api/v1/notes" >/dev/null 2>&1 || true
    fi
    for note in "${review_notes[@]+"${review_notes[@]}"}"; do
        local payload
        payload="$(node -e 'process.stdout.write(JSON.stringify({op:"add",text:process.argv[1],author:"joe",route:process.argv[2]}))' "$note" "$path")"
        curl --noproxy '*' -fsS ${curl_ca[@]+"${curl_ca[@]}"} -X POST \
            -H "authorization: Bearer $api_token" -H 'content-type: application/json' \
            --data "$payload" "$health_url/api/v1/notes" >/dev/null 2>&1 || true
    done
    if [[ -n "$notes_out" ]]; then
        if curl --noproxy '*' -fsS ${curl_ca[@]+"${curl_ca[@]}"} "$health_url/notes.md" -o "$notes_out" 2>/dev/null; then
            msg "$GREEN" "notes" "$notes_out"
        else
            die "error" "could not write notes to $notes_out"
        fi
    fi

    local encoded_path query key value
    encoded_path="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$path")"
    query="path=$encoded_path&v=$viewer_version"
    for key in mode compact scroll scrollMode mirror notes split swap solo focus overlay overlayBlend; do
        case "$key" in
            mode) value="$mode" ;;
            compact) value="$compact" ;;
            scroll) value="$link_scroll" ;;
            scrollMode) value="$scroll_mode" ;;
            mirror) value="$mirror_links" ;;
            notes) value="$notes_open" ;;
            split) value="$split" ;;
            swap) value="$swap" ;;
            solo) value="$solo" ;;
            focus) value="$focus" ;;
            overlay) value="$overlay" ;;
            overlayBlend) value="$overlay_blend" ;;
        esac
        if [[ -n "$value" ]]; then
            value="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$value")"
            query="$query&$key=$value"
        fi
    done
    compare_url="$compare_url/?$query"
    msg "$GREEN" "compare" "$compare_url"
    msg "$DIM" "dev" "$dev_url$path"
    msg "$DIM" "live" "$live_url$path"
    msg "$DIM" "notes" "$notes_file"

    if [[ -n "$should_open" ]]; then
        local compare_browser="${SITE_COMPARE_BROWSER:-Safari}"
        if [[ "$compare_browser" == "Safari" ]] && command -v osascript >/dev/null 2>&1; then
            osascript \
                -e 'on run argv' \
                -e 'tell application "Safari"' \
                -e 'activate' \
                -e 'make new document with properties {URL:item 1 of argv}' \
                -e 'delay 0.5' \
                -e 'set targetID to missing value' \
                -e 'repeat with w in windows' \
                -e 'if URL of current tab of w is item 1 of argv then set targetID to id of w' \
                -e 'end repeat' \
                -e 'if targetID is not missing value then set index of window id targetID to 1' \
                -e 'end tell' \
                -e 'end run' \
                "$compare_url" >/dev/null
            msg "$DIM" "browser" "Safari"
        elif [[ -n "$compare_browser" ]]; then
            open -a "$compare_browser" "$compare_url"
            msg "$DIM" "browser" "$compare_browser"
        else
            open "$compare_url"
        fi
    else
        printf '%s\n' "$compare_url"
    fi
}

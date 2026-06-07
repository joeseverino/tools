#!/usr/bin/env zsh
# grep-vs-rg — benchmark grep vs ripgrep on a directory tree
#
# usage:
#   ./grep-vs-rg.sh [DIR] [PATTERN]
#   RUNS=5 ./grep-vs-rg.sh ~/code function
#
# Uses `hyperfine` if installed (more accurate, with warmup + stats);
# otherwise falls back to zsh's high-resolution clock.

set -eu
zmodload zsh/datetime

DIR=${1:-.}
PATTERN=${2:-function}
RUNS=${RUNS:-3}

# colors (only when stdout is a terminal)
if [[ -t 1 ]]; then
  B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'
else
  B=''; D=''; G=''; Y=''; R=''; C=''; N=''
fi

(( ${+commands[rg]} ))   || { print -ru2 -- "${R}ripgrep not installed.${N} Try: brew install ripgrep"; exit 1; }
(( ${+commands[grep]} )) || { print -ru2 -- "${R}grep not installed${N}"; exit 1; }
[[ -d $DIR ]]            || { print -ru2 -- "${R}not a directory:${N} $DIR"; exit 1; }
DIR=${DIR:A}

print
print -- "${B}grep vs ripgrep${N}"
print -- "  pattern:  ${C}${PATTERN}${N}"
print -- "  dir:      ${C}${DIR}${N}"
print -- "  runs:     ${C}${RUNS}${N}"
print

# warm filesystem cache so the first tool doesn't pay the disk-read tax
print -n -- "${D}warming filesystem cache… ${N}"
grep -rn "$PATTERN" "$DIR" >/dev/null 2>&1 || true
rg   -n  "$PATTERN" "$DIR" >/dev/null 2>&1 || true
print -- "${D}done${N}"
print

# hyperfine path
if (( ${+commands[hyperfine]} )); then
  print -- "${D}using hyperfine for precise measurement${N}"
  print
  hyperfine --warmup 1 --runs "$RUNS" \
    "grep -rn '$PATTERN' '$DIR'" \
    "rg -n '$PATTERN' '$DIR'"
  exit 0
fi

# fallback: manual timing with $EPOCHREALTIME (float seconds)
typeset -F grep_sum=0 rg_sum=0
typeset -F grep_min grep_max rg_min rg_max
typeset -a grep_times rg_times

for ((i=1; i<=RUNS; i++)); do
  s=$EPOCHREALTIME; grep -rn "$PATTERN" "$DIR" >/dev/null 2>&1 || true; e=$EPOCHREALTIME
  t=$(( e - s ));   grep_times+=($t); grep_sum=$(( grep_sum + t ))
  (( i == 1 || t < grep_min )) && grep_min=$t
  (( i == 1 || t > grep_max )) && grep_max=$t

  s=$EPOCHREALTIME; rg -n "$PATTERN" "$DIR" >/dev/null 2>&1 || true; e=$EPOCHREALTIME
  t=$(( e - s ));   rg_times+=($t); rg_sum=$(( rg_sum + t ))
  (( i == 1 || t < rg_min )) && rg_min=$t
  (( i == 1 || t > rg_max )) && rg_max=$t
done

grep_avg=$(( grep_sum / RUNS ))
rg_avg=$(( rg_sum / RUNS ))
speedup=$(( grep_avg / rg_avg ))

fmt()      { printf '%.3fs' "$1" }
fmt_list() {
  local out=()
  for x in "$@"; do out+=("$(fmt "$x")"); done
  print -- "${(j:, :)out}"
}

printf "${B}%-7s  %9s  %9s  %9s   %s${N}\n" tool min avg max runs
printf "%-7s  %9s  %9s  %9s   %s\n" ─────── ───────── ───────── ───────── ─────
printf "%-7s  ${Y}%9s${N}  ${Y}%9s${N}  ${Y}%9s${N}   %s\n" grep \
  "$(fmt "$grep_min")" "$(fmt "$grep_avg")" "$(fmt "$grep_max")" "$(fmt_list "${grep_times[@]}")"
printf "%-7s  ${G}%9s${N}  ${G}%9s${N}  ${G}%9s${N}   %s\n" rg \
  "$(fmt "$rg_min")"   "$(fmt "$rg_avg")"   "$(fmt "$rg_max")"   "$(fmt_list "${rg_times[@]}")"
print
printf "  ${B}ripgrep is ${G}%.1f×${N}${B} faster${N} ${D}(avg of %d runs)${N}\n" "$speedup" "$RUNS"
print

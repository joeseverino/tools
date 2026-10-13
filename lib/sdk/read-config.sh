#!/usr/bin/env bash
# Sources the config file in $1 and prints each requested variable NUL-delimited:
# "S name value" for a set scalar, "A name count item..." for an array.
# Requests are $2...: "S:NAME" for a scalar, "A:NAME" for an array.
set -eu
# shellcheck source=/dev/null
source "$1"
shift
set +u
for spec; do
  kind=${spec%%:*}
  name=${spec#*:}
  if [ "$kind" = S ]; then
    if [ -n "${!name+x}" ]; then printf 'S\0%s\0%s\0' "$name" "${!name}"; fi
  else
    ref="${name}[@]"
    count=0
    for item in "${!ref}"; do count=$((count + 1)); done
    printf 'A\0%s\0%s\0' "$name" "$count"
    for item in "${!ref}"; do printf '%s\0' "$item"; done
  fi
done

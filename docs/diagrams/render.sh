#!/usr/bin/env bash
# Re-render the committed diagram PNGs from the .mmd sources.
# Pre-rendered pixels because GitHub's live mermaid clips node text in Safari.
#
# Same renderer (and reasoning) as the canonical one in Joe's profile repo —
# this is a deliberate copy so these diagrams re-render standalone:
#   https://github.com/joeseverino/joeseverino/blob/main/diagrams/render.sh
set -euo pipefail
cd "$(dirname "$0")"
for src in *.mmd; do
    npx -y -p @mermaid-js/mermaid-cli mmdc -i "$src" -o "${src%.mmd}.png" -w 1100 -s 2 -b white
done

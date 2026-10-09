#!/usr/bin/env bash
# Usage: bash scripts/log-checkpoint.sh <n> "<what to try>"  -- runs checkpoint, appends to CHECKPOINTS.md
cd "$(dirname "$0")/.."
OUT=$(bash scripts/checkpoint.sh "$1" 2>&1 | grep -v 'injected env')
echo "$OUT"
{ echo; echo "## Phase $1 — $(date '+%Y-%m-%d %H:%M')"; echo '```'; echo "$OUT"; echo '```'; echo "**Try it now:** $2"; } >> CHECKPOINTS.md
echo "$OUT" | grep -q "ALL PASS"

#!/usr/bin/env bash
# Run the full fixture × scope matrix and print a scoreboard.
#
# Invokes spike.sh for each cell, collects the per-variant grade JSON
# from snapshots/, and prints a single summary table.
#
# Each variant runs `claude -p` with up to --max-budget-usd 3 (probe) +
# $1 (extractor). Budget the full matrix accordingly.
#
# Usage:
#   ./evals/run-matrix.sh
#
# Not wired into CI; see #164.

set -uo pipefail  # note: no -e — we want to continue past failing cells

EVAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
SNAP_DIR="$EVAL_ROOT/snapshots"
FIXTURES=(dirsql-scope dirsql-scope-blinder)
SCOPES=(webfetch websearch)

declare -a GRADE_FILES
START_TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

for fixture in "${FIXTURES[@]}"; do
  for scope in "${SCOPES[@]}"; do
    echo
    echo "=============================================="
    echo "  variant: ${fixture}__${scope}"
    echo "=============================================="
    # Capture the newest grade file after each run.
    "$EVAL_ROOT/spike.sh" "$fixture" "$scope"
    rc=$?
    if [[ $rc -eq 2 ]]; then
      echo "  ABORT: probe returned empty output (likely API rate-limit). Stopping matrix."
      break 2
    elif [[ $rc -ne 0 ]]; then
      echo "  (cell exited $rc — continuing)"
    fi
    latest="$(ls -1t "$SNAP_DIR/${fixture}__${scope}"-*-grade.json 2>/dev/null | head -1 || true)"
    if [[ -n "$latest" ]]; then
      GRADE_FILES+=("$latest")
    else
      echo "  WARN: no grade file produced for ${fixture}__${scope}"
    fi
  done
done

echo
echo "=============================================="
echo "  SCOREBOARD (run started $START_TS)"
echo "=============================================="
python3 - "${GRADE_FILES[@]}" <<'PY'
import json, sys
rows = []
for path in sys.argv[1:]:
    with open(path) as f:
        g = json.load(f)
    rows.append((g.get('variant', '?'), g['score'], g.get('fails', [])))
w = max((len(v) for v, _, _ in rows), default=10)
print(f"{'variant':<{w}}  score  fails")
print(f"{'-'*w}  -----  -----")
for v, s, fails in rows:
    flist = ', '.join(fails) if fails else '—'
    print(f"{v:<{w}}  {s:<5}  {flist}")
PY

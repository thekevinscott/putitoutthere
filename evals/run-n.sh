#!/usr/bin/env bash
# Run the spike eval N times in sequence, print a score table.
#
# Usage:
#   ./evals/run-n.sh [fixture] [n]
#
# Defaults: dirsql-isolated 5.
#
# Sequential (not parallel) because agent-browser shares a daemon and
# the docs server binds a fixed port per run. Budget: each run is
# ~$5-8; N=5 runs about $25-40.
#
# Aborts the loop early on spike.sh exit 6 (rate-limited) so a rate
# limit at run 2 doesn't burn another 4 doomed probes.

set -uo pipefail

FIXTURE="${1:-dirsql-isolated}"
N="${2:-5}"
EVAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
LOG_PREFIX="/tmp/evals-${FIXTURE}-${TS}"

declare -a ROWS

for i in $(seq 1 "$N"); do
  echo "=== run $i/$N ==="
  logfile="${LOG_PREFIX}-run${i}.log"
  "$EVAL_ROOT/spike.sh" "$FIXTURE" > "$logfile" 2>&1
  rc=$?
  grade_path=$(grep -oE 'snapshots/[^ ]+-grade\.json' "$logfile" | head -1)
  if [[ -n "$grade_path" && -f "$EVAL_ROOT/../$grade_path" ]]; then
    grade="$EVAL_ROOT/../$grade_path"
    score=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['score'])" "$grade" 2>/dev/null || echo '?/?')
    fails=$(python3 -c "import json,sys; print(', '.join(json.load(open(sys.argv[1]))['fails']) or 'none')" "$grade" 2>/dev/null || echo '?')
  else
    score='?/?'
    fails='(no grade — see log)'
  fi
  ROWS+=("run $i: $score | fails: $fails")
  echo "  → $score"

  if [[ $rc -eq 6 ]]; then
    echo "  ABORT: spike returned rate-limit signal (exit 6). Halting loop."
    break
  fi
done

echo
echo "=== summary ($FIXTURE × ${#ROWS[@]} completed of $N requested) ==="
for row in "${ROWS[@]}"; do echo "$row"; done

# Derive a cross-run primitive stability table.
echo
echo "=== primitive stability ==="
python3 <<PY
import json, glob, os
snap_dir = "$EVAL_ROOT/snapshots"
ts_prefix = "$TS"
# Find grade files written after this run started.
grades = []
for p in sorted(glob.glob(os.path.join(snap_dir, "${FIXTURE}-*-grade.json"))):
    with open(p) as f:
        g = json.load(f)
    if g["timestamp"] >= ts_prefix:
        grades.append(g)
if not grades:
    print("(no grades to summarize)")
else:
    primitives = list(grades[0]["results"].keys())
    width = max(len(p) for p in primitives) + 2
    header = "primitive".ljust(width) + " | " + " | ".join(f"r{i+1}" for i in range(len(grades))) + " | truth"
    print(header)
    print("-" * len(header))
    for prim in primitives:
        truth = grades[0]["results"][prim]["truth"]
        cells = []
        for g in grades:
            claim = g["results"][prim]["claim"]
            cell = {
                "shipped": "✓s" if g["results"][prim]["pass"] else "✗s",
                "missing": "✓m" if g["results"][prim]["pass"] else "✗m",
                "not_mentioned": "·",
            }.get(claim, "?")
            cells.append(cell.ljust(2))
        print(prim.ljust(width) + " | " + " | ".join(cells) + f" | {truth}")
    print()
    print("Legend: ✓s=correctly shipped  ✓m=correctly missing  ✗=wrong claim  ·=not_mentioned")
PY

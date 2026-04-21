#!/usr/bin/env bash
# Agent-behavior eval spike.
#
# Runs a condensed single-turn probe against a fixture and grades the
# output against its expected.json. Two axes vary independently:
#
#   1. Fixture — picks the prompt (leading vs. blinder).
#        dirsql-scope          — names dirsql's specific pain points.
#        dirsql-scope-blinder  — gives only structural context.
#   2. Scope — picks the probe's tool access.
#        webfetch   (default) — WebSearch + WebFetch (source-code reachable
#                               via raw.githubusercontent.com).
#        websearch            — WebSearch only (docs-site snippets only;
#                               closer to what the original dirsql session
#                               agent actually exercised).
#
# Output snapshot name is `<fixture>__<scope>-<ts>-*`. Each variant grades
# independently against the same ground-truth expected.json; comparing
# scores across variants tells us whether failures are prompt-driven
# (leading vs. blinder) or tool-driven (WebFetch visibility).
#
# Usage:
#   ./evals/spike.sh [fixture] [scope]
#   ./evals/spike.sh dirsql-scope-blinder websearch
#
# Requires: `claude` CLI on $PATH; Anthropic API access.
# Not wired into CI yet; see issue #164.

set -euo pipefail

FIXTURE="${1:-dirsql-scope}"
SCOPE="${2:-webfetch}"
EVAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
FIXTURE_DIR="$EVAL_ROOT/fixtures/$FIXTURE"
SNAP_DIR="$EVAL_ROOT/snapshots"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
VARIANT="${FIXTURE}__${SCOPE}"
RAW="$SNAP_DIR/${VARIANT}-${TS}-raw.md"
EXTRACT="$SNAP_DIR/${VARIANT}-${TS}-extracted.json"
GRADE="$SNAP_DIR/${VARIANT}-${TS}-grade.json"

case "$SCOPE" in
  webfetch)   ALLOWED_TOOLS="WebSearch WebFetch" ;;
  websearch)  ALLOWED_TOOLS="WebSearch" ;;
  *)
    echo "ERROR: unknown scope '$SCOPE'. Expected: webfetch | websearch" >&2
    exit 1
    ;;
esac

mkdir -p "$SNAP_DIR"

if [[ ! -f "$FIXTURE_DIR/prompt.md" ]]; then
  echo "ERROR: fixture '$FIXTURE' not found at $FIXTURE_DIR/prompt.md" >&2
  exit 1
fi
if [[ ! -f "$FIXTURE_DIR/expected.json" ]]; then
  echo "ERROR: fixture '$FIXTURE' missing expected.json at $FIXTURE_DIR/expected.json" >&2
  exit 1
fi

# Isolate from the project CLAUDE.md by running from a scratch dir.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> probe: variant=$VARIANT (Opus 4.7, tools: $ALLOWED_TOOLS)"
cd "$WORK"
claude -p \
  --model claude-opus-4-7 \
  --tools "$(echo "$ALLOWED_TOOLS" | tr ' ' ',')" \
  --allowed-tools "$ALLOWED_TOOLS" \
  --max-budget-usd 3 \
  --output-format text \
  "$(cat "$FIXTURE_DIR/prompt.md")" \
  > "$RAW"

echo "    raw output: $RAW ($(wc -l < "$RAW") lines)"

# Probe failed to produce real output — typically an API rate-limit or
# permission denial. Bail before burning the extractor on garbage.
if ! [[ -s "$RAW" ]] || [[ "$(wc -c < "$RAW")" -lt 200 ]]; then
  echo "ERROR: probe output is empty or suspiciously short. Contents:" >&2
  cat "$RAW" >&2
  exit 2
fi

echo "==> extract: Haiku reads the prose and emits structured claims"
EXTRACTION_PROMPT=$(cat <<'EOF'
You are an extractor. Read the evaluation below and determine, for each
primitive, whether the evaluator CLAIMS it is shipped, missing, or does
not mention it.

Output a single JSON object on its own line, no markdown, no prose:

{
  "npm_platform_family":               "shipped" | "missing" | "not_mentioned",
  "depends_on_serialization":          "shipped" | "missing" | "not_mentioned",
  "idempotent_precheck":               "shipped" | "missing" | "not_mentioned",
  "bundled_cli_understood":            "shipped" | "missing" | "not_mentioned",
  "per_target_runner_override":        "shipped" | "missing" | "not_mentioned",
  "doctor_oidc_trust_policy_check":    "shipped" | "missing" | "not_mentioned"
}

Rules:
- "shipped" means the evaluator concludes piot already has it.
- "missing" means the evaluator concludes piot lacks it or recommends
  adding it.
- "not_mentioned" means the evaluator does not address this primitive.
- If the evaluator hedges ("worth verifying", "unclear"), treat as
  "not_mentioned" unless the overall conclusion is clear.
- Match by meaning, not keyword. For "bundled_cli_understood": does the
  evaluator demonstrate understanding of what bundled-cli does, or
  merely note the name exists?

Evaluation follows.
===
EOF
)

claude -p \
  --model claude-haiku-4-5-20251001 \
  --tools "" \
  --max-budget-usd 1 \
  --output-format text \
  "$EXTRACTION_PROMPT

$(cat "$RAW")" \
  > "$EXTRACT.raw"

# The model sometimes wraps JSON in fences; strip them.
python3 -c "
import json, re, sys
raw = open('$EXTRACT.raw').read()
m = re.search(r'\{[^{}]*\}', raw, re.DOTALL)
if not m:
    print('ERROR: no JSON object found in extractor output', file=sys.stderr)
    print(raw, file=sys.stderr)
    sys.exit(1)
obj = json.loads(m.group(0))
open('$EXTRACT', 'w').write(json.dumps(obj, indent=2) + '\n')
print('    extracted: $EXTRACT')
print(json.dumps(obj, indent=2))
"

echo "==> grade: compare extracted vs. expected"
python3 -c "
import json, sys
extracted = json.load(open('$EXTRACT'))
expected = json.load(open('$FIXTURE_DIR/expected.json'))['primitives']

results = {}
fails = []
for key, spec in expected.items():
    truth = spec['truth']  # 'shipped' or 'missing'
    claim = extracted.get(key, 'not_mentioned')
    ok = (claim == truth)
    results[key] = {'truth': truth, 'claim': claim, 'pass': ok}
    if not ok:
        fails.append(key)

grade = {
    'fixture': '$FIXTURE',
    'scope': '$SCOPE',
    'variant': '$VARIANT',
    'timestamp': '$TS',
    'model': 'claude-opus-4-7',
    'pass': len(fails) == 0,
    'score': f'{len(expected) - len(fails)}/{len(expected)}',
    'results': results,
    'fails': fails,
}
open('$GRADE', 'w').write(json.dumps(grade, indent=2) + '\n')
print(json.dumps(grade, indent=2))
sys.exit(0 if grade['pass'] else 1)
"

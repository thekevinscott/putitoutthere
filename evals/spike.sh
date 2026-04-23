#!/usr/bin/env bash
# Agent-behavior eval spike.
#
# Runs a single-turn probe against a fixture and grades the output
# against its expected.json.
#
# Two fixture shapes exist:
#
#   1. "scope" fixtures (dirsql-scope, dirsql-scope-blinder) — probe
#      runs in a scratch dir with only web tools. Uses the `scope` arg
#      (`webfetch` | `websearch`) to vary tool access. This is a
#      docs-regression harness, not a reproduction of the motivating
#      session's failure mode. Kept for coverage.
#
#   2. "isolated" fixtures (dirsql-isolated, …) — the canonical shape.
#      Probe runs inside a cloned copy of the target consumer repo
#      (dirsql) with piot's docs served live from `vitepress dev` on
#      a local port. The probe uses `agent-browser` (Vercel Labs CLI +
#      local Chromium) to navigate the docs site exactly the way a
#      real external agent would use WebFetch against the deployed
#      site. Piot's source tree on the host is hidden from the probe
#      via a mount namespace (tmpfs masks /home/user/put-it-out-there),
#      so the only view of piot is whatever the local docs site
#      exposes — the variable under iteration.
#
# Which shape a fixture uses is inferred from the presence of
# `fixtures/<name>/setup.sh`; the docs-server opt-in is inferred from
# `fixtures/<name>/docs_server` (marker file, contents ignored).
#
# Usage:
#   ./evals/spike.sh [fixture] [scope]
#   ./evals/spike.sh dirsql-isolated
#   ./evals/spike.sh dirsql-scope-blinder websearch
#
# Requires:
#   - `claude` CLI on $PATH; Anthropic API access
#   - `git` (for fixtures that clone a consumer repo)
#   - `pnpm` + `docs/` deps installed (`pnpm install --dir docs`)
#   - `agent-browser` globally installed (`npm i -g agent-browser`)
#   - Chromium at $PIOT_CHROME (default: /opt/chrome-linux/chrome)
#   - `unshare` with unprivileged user+mount namespace support
#
# Not wired into CI yet; see issue #164.

set -euo pipefail

FIXTURE="${1:-dirsql-scope}"
SCOPE="${2:-webfetch}"
EVAL_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$EVAL_ROOT/.." && pwd)"
FIXTURE_DIR="$EVAL_ROOT/fixtures/$FIXTURE"
SNAP_DIR="$EVAL_ROOT/snapshots"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
CHROME_BIN="${PIOT_CHROME:-/opt/chrome-linux/chrome}"

mkdir -p "$SNAP_DIR"

if [[ ! -f "$FIXTURE_DIR/prompt.md" ]]; then
  echo "ERROR: fixture '$FIXTURE' not found at $FIXTURE_DIR/prompt.md" >&2
  exit 1
fi
if [[ ! -f "$FIXTURE_DIR/expected.json" ]]; then
  echo "ERROR: fixture '$FIXTURE' missing expected.json at $FIXTURE_DIR/expected.json" >&2
  exit 1
fi

SHAPE="scope"
DOCS_SERVER="no"
if [[ -x "$FIXTURE_DIR/setup.sh" ]]; then
  SHAPE="isolated"
  VARIANT="$FIXTURE"
  if [[ -f "$FIXTURE_DIR/docs_server" ]]; then
    DOCS_SERVER="yes"
  fi
else
  VARIANT="${FIXTURE}__${SCOPE}"
  case "$SCOPE" in
    webfetch)   ALLOWED_TOOLS="WebSearch WebFetch" ;;
    websearch)  ALLOWED_TOOLS="WebSearch" ;;
    *) echo "ERROR: unknown scope '$SCOPE'." >&2; exit 1 ;;
  esac
fi

RAW="$SNAP_DIR/${VARIANT}-${TS}-raw.md"
EXTRACT="$SNAP_DIR/${VARIANT}-${TS}-extracted.json"
GRADE="$SNAP_DIR/${VARIANT}-${TS}-grade.json"

WORK="$(mktemp -d)"
DOCS_PID=""
DOCS_PORT=""
DOCS_URL=""

cleanup() {
  local rc=$?
  if [[ -n "$DOCS_PID" ]] && kill -0 "$DOCS_PID" 2>/dev/null; then
    kill "$DOCS_PID" 2>/dev/null || true
    wait "$DOCS_PID" 2>/dev/null || true
  fi
  # agent-browser daemon may persist across runs — close it for hygiene.
  agent-browser close --all >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit $rc
}
trap cleanup EXIT INT TERM

# --- Pre-flight for isolated+docs-server fixtures ---
if [[ "$SHAPE" == "isolated" && "$DOCS_SERVER" == "yes" ]]; then
  command -v agent-browser >/dev/null || { echo "ERROR: agent-browser not on PATH (npm i -g agent-browser)" >&2; exit 4; }
  [[ -x "$CHROME_BIN" ]] || { echo "ERROR: Chromium not found at $CHROME_BIN (set PIOT_CHROME)" >&2; exit 4; }
  [[ -d "$REPO_ROOT/docs/node_modules" ]] || { echo "ERROR: docs deps missing (pnpm install --dir docs)" >&2; exit 4; }
  command -v unshare >/dev/null || { echo "ERROR: unshare not on PATH" >&2; exit 4; }

  # Build the docs once, then serve the built output via
  # `vitepress preview` — a lightweight express-like server that
  # understands cleanUrls (so `/guide/handoffs/polyglot-rust`
  # resolves to `polyglot-rust.html`). `python3 -m http.server` was
  # the earlier attempt; it doesn't implement cleanUrls and silently
  # 404'd the probe on almost every sidebar link, masquerading as
  # "not_mentioned" primitives in the grade. `vitepress preview` is
  # serve-only (no HMR, no file watcher) so it's stable under
  # concurrent chromium load, unlike `vitepress dev`.
  DOCS_LOG="$SNAP_DIR/${VARIANT}-${TS}-docs.log"
  echo "==> docs: vitepress build (log: $DOCS_LOG)"
  if ! ( cd "$REPO_ROOT/docs" && pnpm build ) > "$DOCS_LOG" 2>&1; then
    echo "ERROR: vitepress build failed"; tail -20 "$DOCS_LOG" >&2; exit 3
  fi

  DOCS_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
  DOCS_URL="http://localhost:${DOCS_PORT}/put-it-out-there/"
  echo "==> docs: vitepress preview on port $DOCS_PORT → $DOCS_URL"
  ( cd "$REPO_ROOT/docs" && exec ./node_modules/.bin/vitepress preview --port "$DOCS_PORT" --host 127.0.0.1 ) >> "$DOCS_LOG" 2>&1 &
  DOCS_PID=$!
  for _ in $(seq 1 30); do
    curl -sf "$DOCS_URL" -o /dev/null 2>/dev/null && { echo "    ready at $DOCS_URL"; break; }
    sleep 0.3
  done
  curl -sf "$DOCS_URL" -o /dev/null 2>/dev/null || { echo "ERROR: preview not ready"; tail -20 "$DOCS_LOG" >&2; exit 3; }
fi

PROMPT_TEXT="$(cat "$FIXTURE_DIR/prompt.md")"
if [[ "$DOCS_SERVER" == "yes" ]]; then
  PROMPT_TEXT="${PROMPT_TEXT//\{\{DOCS_URL\}\}/$DOCS_URL}"
fi

if [[ "$SHAPE" == "isolated" ]]; then
  echo "==> setup: $FIXTURE_DIR/setup.sh $WORK"
  "$FIXTURE_DIR/setup.sh" "$WORK"

  # Settings file: pre-approves the tools the foreign agent had,
  # denies piot-source paths as belt-and-suspenders on top of the
  # mount-namespace mask.
  mkdir -p "$WORK/.claude"
  cat > "$WORK/.claude/settings.local.json" <<EOF
{
  "permissions": {
    "allow": [
      "Read",
      "Grep",
      "Glob",
      "Bash(agent-browser:*)",
      "Bash(git:*)",
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(grep:*)",
      "Bash(find:*)",
      "Bash(pwd)",
      "Bash(wc:*)",
      "Bash(head:*)",
      "Bash(tail:*)"
    ],
    "deny": [
      "Read(/home/user/put-it-out-there/**)",
      "Grep(/home/user/put-it-out-there/**)",
      "Glob(/home/user/put-it-out-there/**)",
      "WebFetch",
      "WebSearch"
    ]
  }
}
EOF

  if [[ "$DOCS_SERVER" == "yes" ]]; then
    echo "==> probe: variant=$VARIANT (Opus 4.7, via agent-browser → $DOCS_URL)"
    # Run the probe inside a user+mount namespace that masks
    # /home/user/put-it-out-there with an empty tmpfs. This makes piot
    # source unreachable even via Bash (cat /abs/path, git --git-dir=,
    # etc.) — the probe can only see piot through the live docs site.
    # PUPPETEER_EXECUTABLE_PATH / CHROME_PATH tell agent-browser which
    # chromium to drive (since `agent-browser install` can't reach the
    # Chrome CDN from this env).
    printf '%s' "$PROMPT_TEXT" > "$WORK/_prompt.txt"
    # Pre-write agent-browser's user config so it finds Chromium without
    # the probe having to pass --executable-path on every invocation.
    mkdir -p "$WORK/.agent-browser"
    printf '{"executable_path": "%s"}\n' "$CHROME_BIN" > "$WORK/.agent-browser/config.json"
    unshare --user --mount --map-root-user bash -c "
      mount -t tmpfs tmpfs /home/user/put-it-out-there || exit 5
      cd '$WORK'
      export HOME='$WORK'
      export AGENT_BROWSER_EXECUTABLE_PATH='$CHROME_BIN'
      exec claude -p \
        --model claude-opus-4-7 \
        --max-budget-usd 5 \
        --output-format text \
        \"\$(cat '$WORK/_prompt.txt')\"
    " > "$RAW" 2>&1
  else
    cd "$WORK"
    HOME="$WORK" claude -p \
      --model claude-opus-4-7 \
      --max-budget-usd 5 \
      --output-format text \
      "$PROMPT_TEXT" \
      > "$RAW"
  fi
else
  cd "$WORK"
  claude -p \
    --model claude-opus-4-7 \
    --tools "$(echo "$ALLOWED_TOOLS" | tr ' ' ',')" \
    --allowed-tools "$ALLOWED_TOOLS" \
    --max-budget-usd 3 \
    --output-format text \
    "$PROMPT_TEXT" \
    > "$RAW"
fi

echo "    raw output: $RAW ($(wc -l < "$RAW") lines)"

if ! [[ -s "$RAW" ]] || [[ "$(wc -c < "$RAW")" -lt 200 ]]; then
  echo "ERROR: probe output is empty or suspiciously short:" >&2
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

Primitive definitions — grade strictly against these:

- `npm_platform_family`: Does piot support publishing a per-platform
  sub-package family (`{name}-{target}` per target) + a top-level
  package whose `optionalDependencies` pin them? The ground-truth
  question is whether this MECHANISM exists in piot, not whether it
  fits any specific consumer's exact shape. If the evaluator says
  "piot has build = napi / bundled-cli that generates the family" →
  "shipped". If the evaluator says "piot's family pattern exists but
  doesn't fit dirsql's combined-CLI-plus-napi-in-one-package shape"
  → still "shipped" (the mechanism exists; fit is a separate
  question).

- `depends_on_serialization`: Does piot topologically order publishes
  by `depends_on`? "Shipped" if the evaluator confirms cross-package
  ordering is guaranteed.

- `idempotent_precheck`: Does each handler check the registry before
  publishing and skip if the version is already there?

- `bundled_cli_understood`: Does the evaluator demonstrate
  understanding of what `bundled-cli` actually does — that it packages
  a CLI binary across a target matrix into per-platform npm sub-packages?
  Just saying the config value exists isn't enough; the evaluator has
  to describe the behavior or effect. "Shipped" if they describe it.

- `per_target_runner_override`: Does piot expose a config knob to pick
  a GitHub Actions runner per target (e.g. `runner = "ubuntu-24.04-arm"`
  for `aarch64-unknown-linux-gnu`)? Ground truth: no, it does not —
  runner selection lives in the consumer's workflow YAML. "Missing" if
  the evaluator notes this is absent or calls out runner selection as
  the consumer's responsibility.
  Example phrasings that count as "missing":
  * "piot doesn't support per-target runner config"
  * "runner selection stays in the consumer's workflow"
  * "piot doesn't emit a runner map; your `release.yml` picks runners"
  * "cross-compilation, runner selection … stay in your workflow"

- `doctor_oidc_trust_policy_check`: Does the `doctor` command validate
  that the registered OIDC trusted-publisher policy's caller workflow
  filename matches the consumer's `release.yml` filename? Ground
  truth: no — doctor validates config and auth reachability but does
  not introspect each registry's trust policy. "Missing" if the
  evaluator notes doctor lacks this check or flags the
  filename-pin-vs-rename risk as a concern piot doesn't cover.
  Example phrasings that count as "missing":
  * "doctor doesn't check the trust policy's workflow filename"
  * "piot doesn't validate the OIDC trust policy against your workflow"
  * "the trust policy filename pin is a concrete migration gotcha piot misses"

Rules:

- "shipped" means the evaluator concludes piot has the feature.
- "missing" means the evaluator concludes piot lacks the feature, or
  explicitly flags it as a gap, or says the responsibility is the
  consumer's (for primitives whose ground truth is "missing because
  piot punts on it").
- "not_mentioned" means the evaluator doesn't address the feature
  at all — neither affirms nor denies, neither claims piot covers it
  nor claims it's a gap.
- If the evaluator hedges on an otherwise unmentioned feature, treat
  as "not_mentioned". If the overall conclusion is clear, grade the
  conclusion.
- Match by meaning, not keyword. A table row, bullet point, or
  aside that clearly takes a position counts as a mention.
- Do NOT conflate "piot has feature X" with "piot's feature X fits my
  specific shape." Those are different.

Evaluation follows.
===
EOF
)

HOME="$WORK" claude -p \
  --model claude-sonnet-4-6 \
  --tools "" \
  --max-budget-usd 1 \
  --output-format text \
  "$EXTRACTION_PROMPT

$(cat "$RAW")" \
  > "$EXTRACT.raw"

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
    truth = spec['truth']
    claim = extracted.get(key, 'not_mentioned')
    ok = (claim == truth)
    results[key] = {'truth': truth, 'claim': claim, 'pass': ok}
    if not ok:
        fails.append(key)

grade = {
    'fixture': '$FIXTURE',
    'shape': '$SHAPE',
    'scope': '$SCOPE',
    'variant': '$VARIANT',
    'timestamp': '$TS',
    'model': 'claude-opus-4-7',
    'docs_server': '$DOCS_SERVER',
    'docs_url': '$DOCS_URL',
    'pass': len(fails) == 0,
    'score': f'{len(expected) - len(fails)}/{len(expected)}',
    'results': results,
    'fails': fails,
}
open('$GRADE', 'w').write(json.dumps(grade, indent=2) + '\n')
print(json.dumps(grade, indent=2))
sys.exit(0 if grade['pass'] else 1)
"

# Agent-behavior evals

Spike harness for testing how external agents perceive `putitoutthere`'s
docs and code. See issue #164 for motivation.

## Running

```sh
./evals/spike.sh [fixture-name]    # default: dirsql-scope
```

Requires the `claude` CLI on `$PATH` and Anthropic API access.

## What it does

1. **Probe** — runs `claude -p` (Opus 4.7, `WebSearch + WebFetch` only,
   no local filesystem access) against the fixture's prompt. Captures
   prose output to `snapshots/<fixture>-<ts>-raw.md`.
2. **Extract** — a Haiku call reads the prose and emits a structured
   JSON claim object per primitive. Saved to `snapshots/*-extracted.json`.
3. **Grade** — compares extracted claims to
   `fixtures/<fixture>/expected.json`. Exits non-zero on any mismatch.
   Saved to `snapshots/*-grade.json`.

## Fixture shape

```
fixtures/<name>/
  prompt.md       # open-ended task given to the probe agent
  expected.json   # ground truth: what each primitive actually is
```

## Known limitations of the spike

- **Single-turn, not multi-turn.** The motivating dirsql session was
  8 turns of evolving context. The spike condenses into one prompt.
  Faithful replay is future work.
- **Tool access is broader than a pure `WebSearch` scope.** The probe
  can `WebFetch` raw GitHub URLs, giving it source-code visibility that
  the dirsql session agent may not have exercised as thoroughly. This
  likely explains why the spike's score (5/6) is higher than the
  dirsql session's (approximately 2/6 correct conclusions).
- **Leading prompt.** The current prompt names dirsql's specific pain
  points (cross-compile runners, OIDC filename pinning, partial-failure
  semantics) — effectively pre-specifying what to evaluate. A blinder
  prompt ("here's dirsql's release surface, evaluate piot") would be
  a stricter test.

See #164 for the roadmap beyond this spike.

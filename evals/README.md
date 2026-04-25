# Agent-behavior evals

Harness for testing whether an external agent, reading only piot's
published docs, can reach correct conclusions about piot's feature
surface. See issue #164.

## Running

```sh
./evals/spike.sh dirsql-isolated
```

Exits 0 on full pass, non-zero on any graded primitive miss. Each run
produces three files in `evals/snapshots/`: `*-raw.md` (probe output),
`*-extracted.json` (Haiku-extracted structured claims), `*-grade.json`
(pass/fail per primitive vs. `expected.json`).

## Prerequisites (one-time)

- `claude` CLI on `$PATH`.
- `pnpm install --dir docs`
- `npm i -g agent-browser`
- Chromium at `$PIOT_CHROME` (default `/opt/chrome-linux/chrome`).
  Download from `storage.googleapis.com/chromium-browser-snapshots/Linux_x64/<rev>/chrome-linux.zip`
  — `googlechromelabs.github.io` (agent-browser's default source) is
  not in this environment's egress allow-list.
- `unshare` with unprivileged user+mount namespaces
  (`unshare --user --mount --map-root-user` must succeed).

## Fixture shapes

### `dirsql-isolated` — the canonical reproduction

- Clones `thekevinscott/dirsql` into a scratch dir (`$WORK`).
- Boots `vitepress dev` against this repo's `docs/` on a free port;
  the probe's only view of piot is that live rendered site.
- Runs the probe inside `unshare --user --mount` with a tmpfs masking
  `/home/user/putitoutthere` — piot's source tree on the host is
  invisible from inside the namespace even through `cat /abs/path` or
  `git --git-dir=…` escapes.
- The probe invokes `agent-browser open / snapshot -i / click / close`
  to navigate the local docs through a real browser — not raw markdown
  reads. This matches what the foreign dirsql session did, modulo the
  docs URL (public → localhost).
- Tool surface mirrors the foreign agent's: Read / Grep / Glob inside
  `$WORK`, scoped Bash (`agent-browser`, `git`, `ls`, `cat`, `grep`,
  `find`, `pwd`, `wc`, `head`, `tail`), no WebFetch / WebSearch.

### `dirsql-scope`, `dirsql-scope-blinder` — docs-regression harness

Older fixtures that test "how does the docs site hold up to direct
evaluator framing without a consumer repo in context?" These don't
reproduce the dirsql failure mode — they ask a different question.
Kept because they catch a different class of regression. Invoked as
`./evals/spike.sh dirsql-scope[-blinder] [webfetch|websearch]`.

## Current red baseline (2026-04-22, 3 runs)

Consistent 4/6 across three runs. Signals:

| Primitive                       | 3-run pattern                                           |
|---------------------------------|----------------------------------------------------------|
| `npm_platform_family`           | shipped (correct) × 3                                    |
| `depends_on_serialization`      | shipped (correct) × 3                                    |
| `idempotent_precheck`           | shipped (correct) × 3                                    |
| `bundled_cli_understood`        | shipped × 2, **false-negative "missing"** × 1            |
| `per_target_runner_override`    | **silent** × 3 (truth: missing — no doc surfaces this)   |
| `doctor_oidc_trust_policy_check`| silent × 2, correctly-missing × 1                        |

Baseline snapshots checked in at
`evals/snapshots/dirsql-isolated-2026-04-22T19-*` as the reference to
diff against during docs iteration.

## Iterating on docs

The loop: edit `docs/`, `./evals/spike.sh dirsql-isolated`, diff the
new raw output against the baseline. For each primitive, the probe's
prose is very specific about which doc page it relied on — that's the
best signal for which page a change has to land on.

## Known limitations

- **Single-turn.** The motivating session was 8 turns of accumulating
  context. The harness condenses to one. Multi-turn replay is future
  work.
- **Extractor is an LLM.** Per-run noise is real (run 1 had 2
  silents + 0 false-negatives; run 3 had 1 silent + 1 false-negative,
  on the same underlying text). Treat 3 runs as a baseline sample
  before declaring a primitive fixed.
- **Clone is a moving target.** `setup.sh` clones dirsql's `main` at
  run time. Pin a SHA in `setup.sh` if dirsql drift starts showing up
  in scores.
- **WebFetch cannot reach localhost.** `web_fetch` is server-executed
  and has no network path to this container. That's why the probe
  uses agent-browser + local chromium instead of WebFetch against
  localhost.

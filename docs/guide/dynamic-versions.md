# Dynamic versions (`hatch-vcs`, `setuptools-scm`, maturin)

If your `pyproject.toml` has `[project].dynamic = ["version"]`, your
build backend derives the version itself — usually from git tags
(`hatch-vcs`, `setuptools-scm`) or from a companion `Cargo.toml`
(`maturin`). piot detects this pattern and **does not** rewrite
`pyproject.toml`. That's the right behaviour — piot is a publisher,
not a version computer (see
[`notes/design-commitments.md`](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md)
non-goal #1) — but it means you need to tell the build backend which
version to use.

This page is the recipe for that handoff.

## The failure mode

Without the handoff, a release intended to publish `0.2.13` can ship
as `0.2.13.dev14`. The sequence:

1. piot's `plan` job computes `version = "0.2.13"`.
2. The `build` job runs `uv build --sdist` (or `python -m build --sdist`).
3. `hatch-vcs` reads git: latest tag is `v0.2.12`, HEAD is 14 commits
   ahead → the sdist is named `my-lib-0.2.13.dev14.tar.gz`.
4. The `publish` job uploads that file via `twine`, then creates the
   `v0.2.13` tag. Too late: PyPI already has `0.2.13.dev14`.
5. A subsequent `0.2.13` release fails idempotently (already
   published) or, if re-planned, produces another `.dev<N+1>`.

PyPI doesn't support hard-delete; yank the bad pre-releases via the
project's Release history page.

## Why piot doesn't fix this for you

piot's non-goals explicitly rule out *computing* the version (that's
upstream tooling's job — release-please, release-plz, the `release:`
trailer, or a static `version = "…"` line). When the build backend
*also* computes the version, there are two computation sources and
piot has no authoritative side to defer to.

The right handoff is mechanical: piot tells the build backend
"publish at version X" via an env var the backend already supports.
No new computation, no new source of truth — just a handoff.

## The recipe

Three backends, three env vars. Pick the one your `pyproject.toml`
uses.

### `hatch-vcs` (most common)

```yaml
build:
  steps:
    - uses: astral-sh/setup-uv@v3
    - name: Build sdist
      working-directory: ${{ matrix.path }}
      env:
        # Name-suffix is uppercased, dashes → underscores.
        # Package "my-lib" → MY_LIB. Package "coaxer" → COAXER.
        SETUPTOOLS_SCM_PRETEND_VERSION_FOR_MY_LIB: ${{ fromJSON(needs.plan.outputs.matrix)[0].version }}
      run: uv build --sdist
```

`hatch-vcs` reads this env var via the
[`setuptools-scm`](https://setuptools-scm.readthedocs.io/en/latest/overrides/)
override mechanism it inherits. The package-specific form
(`…_FOR_<PKG>`) scopes the override to a single project, which
matters in monorepos.

### `setuptools-scm`

Same env-var name — `SETUPTOOLS_SCM_PRETEND_VERSION_FOR_<PKG>`. Same
naming convention.

### `maturin` reading `Cargo.toml`

If your PyPI package is a maturin wheel that picks its version from a
companion `Cargo.toml`, the version flows through a different path:
keep `[package].version` in `Cargo.toml` in sync with what piot
plans. Two options:

- **Static `Cargo.toml` version + piot rewriter.** Declare the
  package once in `putitoutthere.toml` as both a `crates` and a
  `pypi` entry (with `depends_on`). piot rewrites `Cargo.toml`'s
  version for the crates publish; maturin reads that rewritten value.
- **Dynamic `Cargo.toml` version.** Use `cargo-edit`'s
  `cargo set-version <version>` in the build step, before
  `maturin build`, passing the planned version from the plan job's
  matrix output.

See the [polyglot Rust library shape](/guide/shapes/polyglot-rust)
for a worked example.

## Where to set the env var

**The build job, not the publish job.** The build backend reads the
env var when `uv build` (or `python -m build`) runs. Setting it on
the publish job has no effect — the sdist is already built and
uploaded by then.

The planned version is available as a per-package field on the plan
job's output matrix. The exact key depends on what your plan job
emits; the scaffolded `release.yml` includes `version` on each matrix
row.

## Verifying the handoff

After the first run, confirm the sdist name is right:

```bash
# In the publish job, before the piot step:
ls artifacts/*/
# Expected: my-lib-0.2.13.tar.gz
# NOT:      my-lib-0.2.13.dev14.tar.gz
```

If you see a `.devN` suffix, the env var isn't reaching the build
backend. Common causes:

- Env var set on the publish job instead of the build job.
- Env-var name mismatch: package "my-lib" → `MY_LIB` (uppercase,
  dashes → underscores). Package "my.lib" → `MY_LIB` too (dots also
  collapse to underscores per PEP 503 normalisation).
- Build backend ignores the override (very old `setuptools-scm`
  versions). Upgrade to `setuptools-scm >= 7` / `hatch-vcs >= 0.3`.

## What piot logs when it detects a dynamic-version project

```
pypi: my-lib: detected dynamic version; skipping pyproject.toml rewrite.
  Planned version: 0.2.13. Pass it to the build backend via one of:
    - SETUPTOOLS_SCM_PRETEND_VERSION_FOR_MY_LIB=0.2.13  (hatch-vcs / setuptools-scm)
    - Update [package].version in Cargo.toml            (maturin reading Cargo)
  Set the env var on the build job, before `uv build` /
  `python -m build` / `maturin build` runs. See
  docs/guide/dynamic-versions.
```

This log fires once per PyPI package with `dynamic = ["version"]`
per publish run. It's informational — piot doesn't refuse to
proceed. If you see it and your sdist is correct, you're fine.

## Cleaning up accidental `.devN` releases

PyPI doesn't allow hard-delete of a version (immutability is one of
PyPI's core guarantees). To hide a bad pre-release:

1. Go to `https://pypi.org/manage/project/<name>/releases/`.
2. Find the `.devN` release.
3. Click **Options → Yank**. Yanked releases are still installable
   via exact pin (`pip install my-lib==0.2.13.dev14`) but no longer
   satisfy default resolution.

Yank the bad pre-release, fix the build-job env var, re-run the
release. piot's idempotency check will skip the already-shipped
good `0.2.13` if that's what you're on; otherwise it cuts the next
version cleanly.

## Related

- [Runner prerequisites](/guide/runner-prerequisites) — twine +
  Python + git identity on the publish runner.
- [Single-package Python library shape](/guide/shapes/python-library) —
  end-to-end worked example.
- [Design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md) —
  non-goal #1 (no version computation).

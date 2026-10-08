# `_matrix.yml` build job primes a cargo cache (#391)

**Summary.** `_matrix.yml`'s build job previously ran every per-target
matrix cell without any Cargo cache. Each cell cold-compiled the full
Rust dep graph on every PR — even PRs that touched nothing Rust-side —
because `~/.cargo/registry` and the per-package `target/` dir started
empty on every runner. On a wide bundle_cli / napi / maturin matrix
this dominated wall-clock: 4-6 min per cell, ~8 min end-to-end on a
typical downstream consumer's `release-precheck.yml` run, with no
headroom against a 10-min PR CI gate.

The build job now runs `Swatinem/rust-cache@v2` immediately after
`actions/checkout`, gated on rows that actually invoke cargo:

- `pypi/maturin` non-sdist (maturin shells out to cargo)
- `npm/napi` (the consumer's `napi build` script calls cargo)
- `npm/bundled-cli` non-main (the engine's `cargo build` for the
  staged CLI binary)

The cache is partitioned by `matrix.target` via `shared-key` so a
write to one target's slot doesn't blow away the next cell's, and
`workspaces` enumerates both `matrix.path` (the consumer's package
crate, where maturin / napi / single-crate bundled-cli compile) and
`matrix.bundle_cli.crate_path` (the bundle_cli crate when it lives
in a separate dir from `matrix.path` — the dirsql shape). Rows that
produce no cargo work (pypi sdist, pure-Python hatch wheels, npm
vanilla, bundled-cli `main`) skip the cache step entirely.

**Required changes.** None — the cache is internal to the reusable
workflow. No consumer config, YAML, or scripts need to change.

**Deprecations removed.** None.

**Behavior changes without code changes.** Per-target matrix cells
that ran cargo cold previously will now restore their dep graph from
GitHub Actions cache storage on the second and subsequent matching
runs (matching = same `matrix.target` + same Cargo.lock contents).
Cache storage accrues against the consumer's repository quota — the
same accounting as any other `actions/cache` consumer, no separate
billing. First run after a `Cargo.lock` change recompiles cold and
takes the same wall-clock as before. The acceptance criterion: a
second matrix run with no `Cargo.lock` change finishes the Rust
compile step in well under one minute per cell.

**Verification.** A `build.yml` (or `release.yml`) run's logs now
show a `cargo cache (#391)` step between `Set up job` and the first
Rust-touching step, on every row that invokes cargo. The step logs
either `Cache hit` (subsequent run, no `Cargo.lock` change) or
`Cache not found` (first run, or after a `Cargo.lock` change) and
records a `~/.cargo` + `target/` save at job end. Pure-Python sdist
and npm vanilla rows do not show the step at all.

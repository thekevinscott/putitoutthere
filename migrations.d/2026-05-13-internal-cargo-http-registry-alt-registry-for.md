# Internal cargo-http-registry alt-registry for crates e2e

**Summary.** Internal change with no consumer-observable impact. Adds
[`cargo-http-registry`](https://github.com/d-e-s-o/cargo-http-registry)
— an off-the-shelf, auth-free cargo alt-registry, the lone
"Verdaccio for cargo" the survey of the cargo-registry ecosystem
turned up — to `e2e-fixture-job.yml`'s publish job, installed via
`cargo install --locked` and started as a background process on
every crates-bearing matrix row. Two internal engine seams in
`src/handlers/crates.ts` consume it: `PIOT_CRATES_REGISTRY_FALLBACK`
retries `cargo publish` against the alt-registry on a 429-rate-limit
shape from real crates.io ("You have published too many versions of
this crate in the last 24 hours") and emits a `::warning::` workflow
command so reviewers see the fallback engaged. A symmetric
`PIOT_CRATES_REGISTRY_PRIMARY` seam routes the publish *only* at the
override URL (no real-crates.io attempt, no fallback); reserved for
any future `*-first-publish` crates fixture. A first attempt on
this issue wired Kellnr; three CI rounds all 403'd because every
*production* cargo alt-registry (Kellnr / alexandrie / ktra /
cratery) is multi-tenant-shaped and deliberately rejects
fixture-style unrecognized identities. The cargo ecosystem has no
analog of npm's per-user self-registration convention, so picking
the one off-the-shelf "no-auth" registry is the only path that
works without auth gymnastics. The reusable consumer workflow
(`release.yml`), `putitoutthere.toml` schema, trailer grammar, the
dogfood `release-rust.yml`, and consumer-facing docs are
untouched. #331.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for consumers. For
contributors running e2e locally: the publish job in
`e2e-fixture-job.yml` now `cargo install`s
`cargo-http-registry@0.1.8` on crates-bearing rows (~70s cold; the
crate has a lightweight dep tree — tokio rt-only + warp + git2, no
openssl-sys / sqlite-sys / aws-lc-sys) and starts it as a
background process bound at `127.0.0.1:35503`. Cargo's
`net.git-fetch-with-cli = true` is written to `~/.cargo/config.toml`
on the same path because libgit2 enforces strict `application/x-git-*`
content-type checking that `cargo-http-registry` doesn't satisfy;
the system `git` binary is more lenient and works fine. The handler
in `src/handlers/crates.ts` now passes `--token <placeholder>`
alongside `--index <url>` on alt-registry invocations because
cargo's CLI refuses to dispatch publish without an explicit
`--token` once `--index` is set — a CLI quirk; the value is never
validated by `cargo-http-registry`. Steady-state crates fixtures
keep their real-crates.io OIDC-TP path unchanged on the happy path;
the fallback only fires when real crates.io returns a 429.

**Verification.** A successful CI run on a PR that hits the
crates.io 24h-per-crate quota (the polyglot fixture's
`piot-fixture-zzz-poly-rust` row) goes green via the alt-registry
fallback with a `::warning::` in the run log naming the fallback URL,
instead of failing red on the 429. When the quota is fresh, the
`e2e (polyglot-everything)` row continues to publish to real
crates.io and the warning does not fire — visible diagnostic
distinction between the two paths. The diagnostic dump step at the
end of every crates-bearing publish job emits the
cargo-http-registry process log, the readiness-endpoint probe, and
the rendered cargo `config.toml` so any future failure has the wire
trace inline in the run log.

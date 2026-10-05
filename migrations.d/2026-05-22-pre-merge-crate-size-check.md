# Pre-merge crate-size check

**Summary.** `putitoutthere check` gained a check that runs
`cargo package --no-verify` for every `kind = "crates"` package and
fails when the resulting `.crate` is larger than crates.io's 10 MiB
(`10485760`-byte) upload limit. Previously an oversized crate — most
often caused by a tracked symlink dragging a build tree into the
package — surfaced only mid-release as a `413 Payload Too Large` from
`cargo publish`, after the verification build. The new check moves
that failure to PR time, before merge.

**Required changes.** None. The check is additive and runs
automatically wherever `putitoutthere check` already runs (the
`check.yml` reusable workflow). For the check to actually measure a
crate, a Rust toolchain (`cargo`) must be on `PATH` in that job; when
`cargo` is absent the check degrades to a no-op rather than failing,
so a check job without Rust set up sees no behavior change.

**Deprecations removed.** None.

**Behavior changes without code changes.** A PR that would produce an
oversized `.crate` now fails `putitoutthere check` with the new
`PIOT_CRATES_PACKAGE_TOO_LARGE` error code, instead of passing the
check and failing later inside the release run's publish job.

**Verification.** Add a `kind = "crates"` package and run
`putitoutthere check` (or open a PR against a repo wired to
`check.yml`) in an environment with `cargo` on `PATH`: an oversized
crate reports `PIOT_CRATES_PACKAGE_TOO_LARGE` naming the `.crate`
size and the 10 MiB limit, while a normally-sized crate reports
nothing.

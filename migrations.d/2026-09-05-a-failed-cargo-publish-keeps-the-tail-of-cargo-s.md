# A failed `cargo publish` keeps the tail of cargo's stderr

**Summary.** GitHub Actions cuts a log line at 64KB — in the live view
and in the downloaded log archive alike — and what it keeps is the head.
The crates handler rendered cargo's entire stderr into the message it
throws, and that message is emitted as a single structured log record, so
the two facts collided on any crate whose verify build is chatty. The
handler runs `cargo publish --allow-dirty --verbose` with
`CARGO_TERM_VERBOSE=true`, which on a cold verify build means hundreds of
KB of `Compiling …` lines; cargo prints the error *last*. The result was a
red run whose whole diagnostic was 64KB of successful build output ending
mid-line, with the failure itself past the cut.

The rendered message is now bounded: the first 4KB, then
`[... N bytes elided ...]`, then the last 16KB. Both ends earn their
place — the head names the phase that was running, the tail is the error
and its `Caused by:` frames — and the byte count is what tells a reader
the stream continued rather than stopped.

The bound applies to the *rendered message* only. Everything that
**decides** still reads the stream whole: the 429 rate-limit predicate
that engages the alternate registry, and the first-publish
trusted-publishing detector that raises
`PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED`. So does the
`$GITHUB_STEP_SUMMARY` failure dump, which reads stderr off the captured
error and writes to a file, where there is no per-line cut. Nothing that
was recorded before is lost — one of the two places it was recorded is
simply now legible.

**Required changes.** None. This is a fix inside the engine's crates
handler.

| | Before | After |
| --- | --- | --- |
| Your `release.yml` | unchanged | unchanged |
| `putitoutthere.toml` | unchanged | unchanged |
| `secrets:` you pass | unchanged | unchanged |

**Deprecations removed.** None.

**Behavior changes without code changes.**

- A `cargo publish` failure whose stderr exceeds ~20KB is reported with
  its middle replaced by `[... N bytes elided ...]`. Under 20KB, the
  message is byte-identical to before.
- The `--- cargo stderr ---` evidence block on the first-publish
  trusted-publishing hint is bounded the same way; the hint text and the
  `PIOT_CRATES_FIRST_PUBLISH_TP_REJECTED` code are unchanged, and the
  detection still runs against the full stream.
- The job-summary dump and the exit code are unchanged. A consumer
  grepping the run log for a string cargo printed late will now find it;
  one grepping for a string in the elided middle should read the job
  summary, which still has it.

**Verification.** On a release run where cargo fails, the `publish` step's
log now ends with cargo's own error rather than a truncated `Compiling`
line. The whole stream is still one click away under the run's job
summary, in the **stderr** block of the failure dump.

---

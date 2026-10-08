# A verbose publish is no longer killed by its own output

**Summary.** The engine captured every subprocess through Node's
`execFile`, which caps combined output at 1 MiB by default. That cap is
not a truncation: on overflow Node raises
`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and sends `SIGTERM` to the child. A
`cargo publish --verbose` on a cold dependency graph, a long `maturin
build`, or an `npm publish` across a large platform family all clear 1
MiB routinely, so a healthy release was killed partway through and
reported as a tool failure that never happened — with the tool's real
stderr discarded, because the overflow error replaces it. Capture is now
unbounded while the subprocess runs and bounded once it finishes, at 8
MiB per stream. Anything past that is replaced by a leading
`[putitoutthere] capture ceiling reached: dropped <n> bytes` line
followed by the head and tail of the stream, so the tool's own error —
which prints at the tail — survives. Both engine entry points now also
drain stdout and stderr before exiting, because `process.exit` discards
queued pipe writes and was cutting large dumps off around 146KB. #664.

**Required changes.** None. No config key, workflow input, CLI flag, or
output shape changes.

**Deprecations removed.** None.

**Behavior changes without code changes.**

| Situation | Before | After |
| --- | --- | --- |
| Subprocess emits over 1 MiB | Child `SIGTERM`ed mid-run; step fails with `stdout maxBuffer length exceeded` and no tool output | Child runs to completion; step outcome reflects what the tool actually did |
| Subprocess emits over 8 MiB on one stream | n/a (never reached) | Head and tail retained, prefixed with `[putitoutthere] capture ceiling reached: dropped <n> bytes` |
| Multi-megabyte failure dump | Truncated around 146KB by the process exit, losing the tail | Delivered whole |
| Ordinary verbose build (~380KB) | Unbounded | Unchanged — well under the ceiling, no banner |

Peak memory during a call is bounded by the subprocess's total output,
not by the 8 MiB ceiling; the ceiling bounds what is retained and
propagated after the call returns.

**Verification.** Re-run a release whose build is verbose enough to have
been failing with `maxBuffer length exceeded`; it now completes. To see
the ceiling itself, check a failed publish's `$GITHUB_STEP_SUMMARY` dump
for the `capture ceiling reached` banner — its absence means the whole
stream was kept.

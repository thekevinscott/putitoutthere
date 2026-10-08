# npm per-triple verification counts nested payloads

**Summary.** `verify npm-tarball --per-triple` downloads each published
platform package back and asserts it ships more than metadata. It counted
the extracted tarball's top level only, keeping just the entries that were
files — so a build that stages its binary nested
(`artifacts/<name>-<triple>/bin/<binary>` instead of flat) produced a
tarball whose top level is `package.json` plus the `bin/` *directory*, the
directory was discarded, and the release failed at the verify step with
`tarball contains only package.json` even though the binary was present at
`package/bin/`. Nothing earlier in the pipeline objects to the nested
shape — the artifact-completeness check lists recursively and accepts
either — so the first and only complaint arrived after every publish had
already happened. The count is now recursive (issue #633).

**Required changes.** None. If a release previously failed at
`Verify published per-triple npm tarballs` on a package whose binary is
staged under a subdirectory, re-run it; nothing in `putitoutthere.toml`,
the reusable workflow's inputs, or your build needs to change. Flattening
the staging layout was the only workaround before and is no longer
necessary — both layouts are accepted, as they already were everywhere
else in the pipeline.

**Deprecations removed.** None.

**Behavior changes without code changes.** Three, all in the per-triple
verify step:

1. A platform tarball whose only payload is nested now passes. The
   failure it used to raise was a false negative — the artifact was
   correct — so no release that should have failed now passes: a tarball
   carrying nothing but `package.json` still fails, exactly as before.
   Empty directories contribute no files, so a `bin/` with nothing in it
   is still a failure.
2. The step's log lines name paths relative to `package/` rather than
   bare filenames: `ok: 2 non-metadata file(s): README.md bin/esbuild`
   where a flat listing previously printed only `README.md`. Anyone
   grepping this step's output for a bare filename should match on the
   trailing segment.
3. The `::error::` line no longer carries a trailing
   `Tarball contents: …` listing. It was built from a second, recursive
   walk while the verdict came from a top-level count, which is how it
   came to name the very binary the same line called absent; now that one
   walk decides, reaching the failure arm means there is nothing left for
   a listing to add. Anyone grepping for `Tarball contents:` on a failed
   per-triple verify should match the sentence instead.

**Verification.** For a package whose platform build stages nested, the
`Verify published per-triple npm tarballs` step reports
`ok: N non-metadata file(s): bin/<binary>` and the job succeeds, where it
previously emitted
`::error::[<pkg>-<triple>@<version>] tarball contains only package.json`.
A genuinely empty artifact dir still fails that step with the same
message, now with a `Tarball contents: package.json` listing that agrees
with it.

---

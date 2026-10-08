# Publish report names the platform packages

**Summary.** A `kind = "npm"` package with `build = "napi"` or
`build = "bundled-cli"` publishes one synthesized platform package per
target alongside the umbrella package — six packages for a five-target
family. The publish report named only the umbrella (issue #625). The
engine already had the facts: `publishPlatforms` returns
`{ published, skipped }`, and the npm handler threw the return away, so
nothing downstream could see it. Because the run log is the only record
of what a release did, a complete multi-package publish and a partial
one that published the umbrella and stopped produced identical output —
the ambiguity that produced the mistaken report in #624. Each
`published[]` entry now carries a `result.platforms` summary, and the
human-readable render lists the platform packages under their umbrella.

**Required changes.** None. Purely additive: no existing field changes
shape or meaning, and a package with no platform family omits the new
key rather than reporting an empty summary. Anything already parsing the
report keeps working. To consume it, read `result.platforms`:

| Before | After |
| --- | --- |
| ```json
{"package":"agent-transcripts-npm","version":"0.0.1",
 "result":{"status":"published","url":"..."},
 "tag":"agent-transcripts-npm-v0.0.1"}
``` | ```json
{"package":"agent-transcripts-npm","version":"0.0.1",
 "result":{"status":"published","url":"...",
   "platforms":{
     "published":["@agent-transcripts/x86_64-unknown-linux-gnu"],
     "skipped":[]}},
 "tag":"agent-transcripts-npm-v0.0.1"}
``` |

`published` and `skipped` hold **registry** names (what the package is
called on npm, `{name}-{triple}` by default or whatever the family's
`name` template renders), in publish order, so they can be pasted
straight at a registry. `skipped` means the package was already live at
this version and was left untouched — on a re-run after a partial
failure, that is the confirmation the missing packages were not lost.

**Deprecations removed.** None.

**Behavior changes without code changes.** Two, both output-only; no
publish behaviour changes and no additional registry calls are made.

- The `--json` report gains `result.platforms` on npm entries with a
  platform family. Absent for every other package.
- The human-readable render (a local `putitoutthere publish` without
  `--json`) gains one indented line per platform package under its
  umbrella: `  platform: <name>  status=published` or
  `status=already-published`.
- The engine additionally logs a one-line family summary to **stderr**
  as the family lands, so a live run log shows it before the final
  report. stdout stays clean for `--json` consumers.

**Verification.** Run a release for a napi or bundled-cli package and
read the publish step's report. Every platform package the registry
received should appear under its umbrella entry:

```console
$ putitoutthere publish --cwd . | tail -n +1
published: my-cli@1.2.3  status=published
  platform: my-cli-x86_64-unknown-linux-gnu  status=published
  platform: my-cli-aarch64-apple-darwin      status=published
```

Cross-check the count against the registry (`npm view my-cli-<triple>
version`): report and registry should now agree package for package.

---

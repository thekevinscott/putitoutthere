# New `verify npm-tarball` subcommand; `verify` becomes a command family

**Summary.** `putitoutthere verify` is now a command family. Bare `verify`
— the #414 OIDC-vs-token publish/trust posture check — is unchanged and
additionally spellable `verify posture`. A new subcommand,
`verify npm-tarball`, downloads a published npm tarball back from the
registry and asserts its contents honor what was declared: main/noarch
rows must contain every directory entry their `package.json` `files[]`
declares, and `--per-triple` asserts each synthesized platform package
ships a non-`package.json` binary. This extracts the two inline bash
blocks the reusable e2e workflow carried (`e2e-fixture-job.yml`) into one
colocated-tested engine command (epic #442, sub-issue #443); the behavior
is unchanged — same row selection, same registry read + retry, same error
messages.

**Required changes.** None. Additive. Consumers compose with the reusable
workflow, not the CLI directly (design-commitment #10); this subcommand is
an internal seam the workflow invokes. Anyone scripting `verify` directly
keeps the same behavior — bare `verify` still means the posture check.

**Deprecations removed.** None.

**Behavior changes without code changes.** None. The reusable workflow's
externally observable behavior (what publishes, tag format, release body)
is identical; only the internal implementation of the post-publish
tarball-verification step moved from inline YAML into the engine.

**Verification.** Run `putitoutthere verify npm-tarball --matrix <plan
matrix> --cwd <repo>` after a publish: it prints `ok: package/<dir>/` per
honored `files[]` directory and exits non-zero (with a `::error::` naming
the missing directory) if the published tarball dropped one.

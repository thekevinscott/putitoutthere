# Known gaps

This page enumerates everything piot **deliberately doesn't do** or
**doesn't do yet**, in one place. If you're evaluating piot for a
migration, read this alongside [Concepts](/guide/concepts) before
assuming a feature is present.

Gaps come in three flavours:

- **Out of scope (permanent).** A design commitment — piot will not
  grow this. Compose with another tool if you need it.
- **Not yet shipped.** Tracked as a GitHub issue; may land later.
- **Documented behaviour you might mistake for a gap.** piot does the
  thing, but the common expectation differs from piot's model.

## Out of scope (permanent non-goals)

Reference: [`notes/design-commitments.md`](https://github.com/thekevinscott/put-it-out-there/blob/main/notes/design-commitments.md).

### Build-side cross-compilation

piot does not run `maturin build`, `napi build`, `cargo build`, or
any other compilation step. Those live in your workflow's `build`
job.

Related: piot **does** accept a per-target runner hint via
object-form `targets` entries (`{ triple, runner }`) and emits that
runner into the build-matrix. But the `build` job that compiles your
binaries is yours to write. See [Configuration → Target entries](/guide/configuration#target-entries).

### Version computation from commit content

piot does not diff commits to infer semver bumps. The version comes
from either (a) a `release: patch|minor|major` commit trailer on
the merge, or (b) `{name, version}` passed directly by an upstream
tool like `release-please` or `release-plz`. piot is polyglot
because it delegates bump computation to language-agnostic trailer
logic or to per-language tools that already solved this.

### Standalone binary archive uploads to GitHub Releases

piot does not emit `.tar.xz` / `.tar.gz` / `.zip` installer archives
on GitHub Releases (the `curl | tar x` install path). That's
[`cargo-dist`](https://axodotdev.github.io/cargo-dist/) and
[`goreleaser`](https://goreleaser.com/) territory; compose with
them. If your release needs both registry publishes and a
curl-installable binary, run cargo-dist and piot from the same
workflow, in parallel.

### Shell hooks / plugin APIs

No `pre_publish`, no `post_tag`, no `on_release`. If you need to run
custom code around publish, do it as workflow steps before or after
the `publish` job. piot's config surface stays declarative.

### Changelogs

Generation and update of `CHANGELOG.md` belongs to `release-please`
or similar. piot doesn't touch changelogs.

### Monorepo discovery

Packages are declared explicitly via `[[package]]` entries. piot
does not walk the filesystem to discover packages. The same config
shape works for single-package and monorepo layouts.

### Auto tag-rollback on partial-publish failure

piot does not delete the git tag after a publish leg fails. crates.io
is immutable — deletion is not a safe undo. piot's pre-publish
completeness check is designed to catch the class of failure that
would have motivated rollback; when a failure still happens
mid-flight, the right response is to bump-and-republish, not to
delete the tag.

### Shared-tag layout (`v{version}` across every package)

piot tags each package independently as `{name}-v{version}`. If your
existing project ships every package under a single shared
`v{version}` tag, that layout is not supported and will not be —
per-package tags let `depends_on` cascades fire independently when
only a subset of packages changes.

## Not yet shipped (tracked)

Status of specific asks. Check the linked issues for current state.
Several items previously on this list — crates `features`
passthrough, npm target-triple mapping, pypi dynamic-version
handling, and PLAN_GAPS reconciliation — have since shipped; see
the closed issues.

- None currently blocking.

## Documented behaviours that look like gaps

### Per-package tags, not a single shared version

A piot release tags each package independently as `{name}-v{version}`
(e.g. `dirsql-rust-v0.3.1`, `dirsql-py-v0.3.1`). Consumers coming
from a single-tag `v0.3.1` layout will see two changes:

- Any install script or doc that parses `v*` tags needs updating.
- A single git `v{version}` tag no longer maps to all three packages
  — you get three parallel tags instead.

This is intentional (each package can version independently when
`depends_on` cascades don't fire) but it's a visible behavioural
change at adoption.

### `bundled-cli` is a packaging shape, not a builder

`build = "bundled-cli"` on a `kind = "npm"` package tells piot to
publish a per-platform family (`{name}-{target}` sub-packages +
top-level `optionalDependencies`). piot does **not** compile the
binary that each sub-package carries — your workflow's `build` job
does that. See [npm platform packages](/guide/npm-platform-packages)
for the full flow.

### Combined CLI + napi under one top-level package

Each `[[package]]` picks one `build` mode. piot cannot publish a
single `dirsql` top-level whose `optionalDependencies` mix both
`@dirsql/cli-<slug>` (CLI binaries via `bundled-cli`) and
`@dirsql/lib-<slug>` (napi addons via `napi`). If you need that
shape, split into two published names (e.g. `dirsql` for the napi
library, `dirsql-cli` for the CLI).

### `doctor`'s trust-policy check is opt-in and scoped

`doctor` validates OIDC trust-policy setup in layered phases, but
only the first runs unconditionally:

- **Trust policy (local)** — always on. Verifies a publishing
  workflow exists, `id-token: write` + `contents: write` are granted,
  an `environment:` is pinned, and the publish step isn't commented
  out.
- **Trust policy (declared)** — runs when any package declares
  `[package.trust_policy]` in `putitoutthere.toml`. Diffs the
  declared workflow filename against the local workflow file and
  (in CI) against `GITHUB_WORKFLOW_REF`. Without a declaration,
  the phase prints a neutral "not declared" line — `doctor` does
  not infer intent.
- **Trust policy (crates.io registry)** — opt-in, runs only when
  `CRATES_IO_DOCTOR_TOKEN` is set in the environment. Cross-checks
  the declaration against the trusted-publisher configs registered
  on crates.io.

For PyPI and npm there is no registry cross-check (neither exposes
an API for it); the declared phase is the full gate there. See
[Authentication → Validating the trust-policy setup locally](/guide/auth#validating-the-trust-policy-setup-locally-doctor).

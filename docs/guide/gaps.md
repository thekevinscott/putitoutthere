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

### `doctor` does not validate your OIDC trust policy

`putitoutthere doctor` validates config, manifest presence, and auth
reachability. It does **not** query each registry to confirm a
trusted publisher is registered for your repo + workflow, and it does
**not** verify that the caller workflow filename matches what your
registered trust policy pins.

crates.io and npm embed the caller workflow filename in the OIDC JWT
claim. A mismatch fails at publish with HTTP 400. If you rename
`release.yml` (or you're migrating from a workflow named something
else), re-register the policy on each registry first — `doctor` can't
catch this, and the first publish will fail loudly if you don't.

The trust-policy UI lives at:

- crates.io: `https://crates.io/crates/<crate>/settings` → Trusted Publishing
- PyPI: `https://pypi.org/manage/project/<name>/settings/publishing/`
- npm: `https://www.npmjs.com/package/<name>/access`

### Per-target GitHub Actions runner selection

piot does **not** expose a `runner = "ubuntu-24.04-arm"` config knob
or equivalent matrix-entry for per-target runner selection. Runner
selection is the consumer's workflow YAML's job — piot's generated
`release.yml` matrix passes `{ name, kind, target }` rows to your
`build` job, and you pick the runner per row. If you need
`ubuntu-24.04-arm` for `aarch64-unknown-linux-gnu`, wire that in your
workflow's matrix, not in `putitoutthere.toml`.

### Build-side cross-compilation

piot does not run `maturin build`, `napi build`, `cargo build`, or
any other compilation step. Those live in your workflow's `build`
job. piot's `build = "maturin" | "napi" | "bundled-cli"` values
declare a **packaging shape** piot knows how to publish; they do
not build.

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

## Not yet shipped (tracked)

Status of specific asks. Check the linked issues for current state.

- [#169](https://github.com/thekevinscott/put-it-out-there/issues/169)
  — `kind = "crates"` handler: pass `features` through to
  `cargo publish`. Config schema has it; handler silently drops it
  today.
- [#170](https://github.com/thekevinscott/put-it-out-there/issues/170)
  — `targetToOsCpu`: error loudly on unsupported triples instead
  of silently synthesising an `{os: [], cpu: []}` per-platform
  package that npm resolves on every platform.
- [#171](https://github.com/thekevinscott/put-it-out-there/issues/171)
  — `kind = "pypi"` handler: handle dynamic-version `pyproject.toml`
  (hatch-vcs, setuptools-scm). Current behaviour assumes static
  `version = "x.y.z"` and errors on projects with
  `dynamic = ["version"]`.
- [#172](https://github.com/thekevinscott/put-it-out-there/issues/172)
  — docs hygiene: reconcile `migrations/PLAN_GAPS.md` with
  `notes/design-commitments.md` and split the "publish-side" and
  "build-side" columns so the Supported / Gap labels are
  unambiguous.

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

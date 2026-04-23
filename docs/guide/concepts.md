# Concepts

## What piot covers

`putitoutthere` (piot) is a **polyglot registry publisher**. Given
artifacts on disk and credentials via OIDC, it publishes to crates.io,
PyPI, and npm — in topological order, idempotently, with completeness
checks so partial publishes are rare. That's the whole tool.

**In scope:**

- Compute which of your declared packages need to ship on a given
  merge (cascade via glob `paths` + transitive `depends_on`).
- Bump each package's version from a `release:` commit trailer.
- Publish in `depends_on` topological order (Rust crate before the
  PyO3 wheel that depends on it, etc.).
- OIDC trusted publishing to all three registries (crates.io, PyPI,
  npm) plus long-lived-token fallback.
- Per-registry idempotent pre-check (`GET` the registry before
  `publish`; skip if already there).
- npm **platform-package families** — per-platform sub-packages
  (`{name}-{target}`) with narrowed `os` / `cpu` / `libc`, plus a
  top-level package whose `optionalDependencies` pin them. Triggered
  by `build = "napi"` or `build = "bundled-cli"`. Details in
  [npm platform packages](/guide/npm-platform-packages).
- Per-target runner selection via object-form `targets` entries
  (`{ triple, runner }`). The planner emits the selected runner into
  the build-job matrix. See [Configuration → Target entries](/guide/configuration#target-entries).
- Declared trust-policy validation: `[package.trust_policy]` in
  `putitoutthere.toml`, then `doctor` diffs against the workflow
  file (always), `GITHUB_WORKFLOW_REF` (in CI), and the crates.io
  registry (when `CRATES_IO_DOCTOR_TOKEN` is set). See
  [Authentication](/guide/auth).
- Create a git tag per package (`{name}-v{version}`) and a GitHub
  Release.

**Explicitly out of scope** (composed from other tools, not absorbed):

- **Build-side compilation.** piot accepts a `runner` hint per target
  and emits the matrix, but your workflow's `build` job runs
  `maturin build`, `napi build`, `cargo build`, etc. piot doesn't
  execute the compile step.
- **Version computation from commit content.** Use `release-please`,
  `release-plz`, or `changesets` to set `{name, version}`, or use the
  `release:` commit trailer. piot does not diff commits to infer
  semver.
- **Standalone binary archive uploads to GitHub Releases**
  (`.tar.xz` / `.tar.gz` / curl-installable tarballs). That is
  `cargo-dist`'s and `goreleaser`'s territory; compose with them.
- **Shell hooks / plugin APIs.** No `pre_publish`, no `post_tag`.
  Run custom steps in your workflow *around* piot, not through
  config.
- **Monorepo discovery.** Packages are declared explicitly via
  `[[package]]` entries. No directory walking.
- **Changelogs.** Delegate to `release-please` or similar.
- **Auto tag-rollback on partial-publish failure.** crates.io is
  immutable; deletion isn't a safe undo. piot relies on the
  pre-publish completeness check to prevent the class of failure
  that would motivate rollback.

Full non-goals list: [`notes/design-commitments.md`](https://github.com/thekevinscott/put-it-out-there/blob/main/notes/design-commitments.md).

## The loop

Every push to `main` triggers the release workflow, which runs three jobs:

1. **plan** — compute which packages need to ship and at what version. Output: a JSON matrix.
2. **build** — fan out across the matrix. User-owned build steps produce the artifacts.
3. **publish** — per package: write version file, run the handler's publish, create a git tag, create a GitHub Release.

## Cascade

Every package declares `paths` — globs that say "these files belong to me." When you merge a commit that touches any of those globs, the package **cascades** into the plan.

If another package declares `depends_on = ["this-package"]`, that downstream also cascades. Transitively. DFS-ordered, with cycle detection at config-load time.

## Trailer

The default behavior is **patch bump on cascade**. To override, add a `release:` trailer to the merge commit:

```
release: minor
```

Or scope it to specific packages:

```
release: major [dirsql-rust, dirsql-cli]
```

See [trailer guide](/guide/trailer) for the full grammar.

## Publishing order

Inside a single release, packages publish in **topological order** of their `depends_on` graph. If your Python wrapper depends on a Rust crate, crate publishes first.

## Idempotency

Every handler's first move is `isPublished` — check the registry for the target version. Already there? Skip cleanly. Lets you re-run failed releases without fighting the registry's immutable-publish semantics.

## Packaging shapes

Each `[[package]]` declares a `kind` (`crates` / `pypi` / `npm`) and, for some kinds, a `build` mode that picks a packaging shape piot knows how to publish. The `build` value is **declarative**: it tells piot what to do at publish time, not how to compile. Producing the binaries is your workflow's job.

- `kind = "crates"` — plain `cargo publish`.
- `kind = "pypi"` with `build = "setuptools" | "hatch" | "maturin"` — sdist + wheel from an existing manifest.
- `kind = "npm"` vanilla (no `build`) — single-package `npm publish --provenance`.
- `kind = "npm"` with `build = "napi" | "bundled-cli"` — platform-package family (per-platform `{name}-{target}` sub-packages + a top-level with `optionalDependencies` pinning them). See [npm platform packages](/guide/npm-platform-packages).

## Dirty working tree

`putitoutthere` rewrites the version field in each package's manifest (`Cargo.toml`, `pyproject.toml`, `package.json`) right before publishing. That edit is intentional and not committed — the release tag points at the unmodified merge commit (see [cascade](/guide/cascade)).

For the crates handler, that means `cargo publish --allow-dirty` is required. Before invoking cargo, `putitoutthere` scans the working tree and refuses to proceed if anything is dirty outside the managed `Cargo.toml` — that narrow scope restores cargo's default safety net without blocking the managed bump.

If you run `putitoutthere publish` locally outside a git work tree (e.g. in a snapshot directory), this guard falls through silently and cargo's own `--allow-dirty` semantics take over. Prefer running publishes from inside a checked-out repo.

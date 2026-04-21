# Concepts

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

## Dirty working tree

`putitoutthere` rewrites the version field in each package's manifest (`Cargo.toml`, `pyproject.toml`, `package.json`) right before publishing. That edit is intentional and not committed — the release tag points at the unmodified merge commit (see [cascade](/guide/cascade)).

For the crates handler, that means `cargo publish --allow-dirty` is required. Before invoking cargo, `putitoutthere` scans the working tree and refuses to proceed if anything is dirty outside the managed `Cargo.toml` — that narrow scope restores cargo's default safety net without blocking the managed bump.

If you run `putitoutthere publish` locally outside a git work tree (e.g. in a snapshot directory), this guard falls through silently and cargo's own `--allow-dirty` semantics take over. Prefer running publishes from inside a checked-out repo.

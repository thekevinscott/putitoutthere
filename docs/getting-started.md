# Getting started

Put It Out There (piot) is a polyglot release orchestrator. One
`putitoutthere.toml` describes your packages; the CLI computes a
release plan from git + a commit trailer and publishes to crates.io,
PyPI, and npm.

## Does piot fit your library?

piot is a good fit if you can answer **yes** to most of these:

- [ ] Your artifacts publish to some combination of **crates.io, PyPI, and npm** — piot only covers those three registries.
- [ ] You use (or are willing to use) **OIDC trusted publishing** on each registry. Long-lived tokens work as a fallback, but OIDC is the happy path.
- [ ] You build your artifacts in **GitHub Actions**. The scaffolded workflow is a GitHub Actions workflow; piot's Action and OIDC flows assume that runtime.
- [ ] You're comfortable with **one tag per package** (`{name}-v{version}`) rather than a single shared version across all packages.
- [ ] Your release trigger is a **merge commit** (push to `main`). A commit trailer drives the version bump; piot is not a cron-driven release orchestrator at the tool level (though you can run it from a cron workflow).
- [ ] You use — or can use — **`release-please` / `release-plz` / `changesets`** for PR-driven version pre-computation, OR commit trailers. piot does not compute bumps from commit-diff heuristics.

piot is probably **not** the right tool if:

- You need a registry piot doesn't cover (Maven, NuGet, Docker Hub, internal registries, etc.).
- You publish from CI systems other than GitHub Actions.
- You want the tool to **generate a cross-compile matrix** for you — piot is publish-side; your workflow owns the build matrix and runner selection.
- You want **standalone binary archives** attached to GitHub Releases with a curl-installable tarball. That's `cargo-dist`'s / `goreleaser`'s lane; compose with them, don't replace them with piot.
- You need **changelog generation**. Delegate to `release-please` or similar.
- You want **automatic tag rollback** on partial-publish failures. piot deliberately doesn't do this — crates.io is immutable, so deletion isn't safe. Instead piot runs a completeness-check before anything ships.

See [Design commitments](https://github.com/thekevinscott/put-it-out-there/blob/main/notes/design-commitments.md) for the full list of non-goals.

## Common library shapes

Worked examples for the common shapes:

- [Polyglot Rust library (Rust crate + PyO3 wheel + napi npm)](/guide/handoffs/polyglot-rust) — the dirsql shape.

## Install

```bash
npx putitoutthere init
```

Scaffolds:

- `putitoutthere.toml` — declare your packages.
- `.github/workflows/release.yml` — plan → build → publish pipeline.
- `.github/workflows/putitoutthere-check.yml` — PR dry-run check.
- `putitoutthere/AGENTS.md` — the trailer convention your LLM agent will follow.

## Minimum config

```toml
[putitoutthere]
version = 1

[[package]]
name = "my-crate"
kind = "crates"
path = "."
paths = ["src/**", "Cargo.toml"]
first_version = "0.1.0"
```

## Release a version

Merge to `main`. A patch release ships automatically. To bump minor or major:

```
release: minor
```

in the merge commit body. See [the trailer guide](/guide/trailer) for the full grammar.

## Further reading

- [Concepts](/guide/concepts) — cascade, trailer, plan/build/publish, and what piot does / doesn't cover.
- [Configuration](/guide/configuration) — every field in `putitoutthere.toml`.
- [CLI reference](/api/cli).

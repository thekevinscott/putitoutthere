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
- [ ] You're comfortable with **one tag per package** — defaults to `{name}-v{version}`, or pick your own template via [`tag_format`](/guide/configuration).
- [ ] Your release trigger is **up to you**: merge to `main`, scheduled cron, or manual dispatch all work. See the [nightly release recipe](/guide/nightly-release) for the cron shape.
- [ ] The default bump is **`patch` whenever a package's files change**. Opt into explicit `minor`/`major` bumps (or `skip`) via a [commit trailer](/guide/trailer) — trailers are optional.

piot is probably **not** the right tool if:

- You need a registry piot doesn't cover (Maven, NuGet, Docker Hub, internal registries, etc.).
- You publish from CI systems other than GitHub Actions.
- You want piot to **run the compile** itself. piot emits the build-job matrix (with per-target `runner` overrides you declare in config), but `maturin build` / `napi build` / `cargo build` still live in your workflow's build step.
- You want **standalone binary archives** attached to GitHub Releases with a curl-installable tarball. That's `cargo-dist`'s / `goreleaser`'s lane; compose with them, don't replace them with piot.
- You need **changelog generation**. Delegate to `release-please` or similar.
- You want **automatic tag rollback** on partial-publish failures. piot deliberately doesn't do this — crates.io is immutable, so deletion isn't safe. Instead piot runs a completeness-check before anything ships.

See [Known gaps](/guide/gaps) for the full enumeration of non-goals
and limitations, or [Design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md) for the policy these are derived from.

## Migrating? Read this first

If you already publish to crates.io / PyPI / npm and you're switching
to piot, two things trip up most migrations:

- **The caller workflow filename is load-bearing for OIDC.** crates.io
  and npm pin the caller workflow filename in the OIDC trust policy's
  JWT claim. If your current trusted publisher is registered against
  (say) `patch-release.yml` and `putitoutthere init` writes a new
  `release.yml`, publish fails with HTTP 400. Declare the expected
  workflow in `putitoutthere.toml` so `doctor` catches the drift
  before cutover:

  ```toml
  [package.trust_policy]
  workflow    = "release.yml"
  environment = "release"
  ```

  With the block in place, `doctor` diffs the declared workflow
  against the local file and (in CI) against `GITHUB_WORKFLOW_REF`.
  See [Authentication → Declaring trust-policy expectations](/guide/auth#declaring-trust-policy-expectations).
- **Tags are per package, not shared.** piot tags each package
  independently as `{name}-v{version}`. Anything reading a single
  shared `v{version}` tag today (install scripts, doc links, release
  notes scripts) needs updating. Single-package repos often want
  `tag_format = "v{version}"` instead, to keep the existing timeline
  — see [Configuration](/guide/configuration).
- **Dynamic-version `pyproject.toml`.** If your PyPI package uses
  `[project].dynamic = ["version"]` with hatch-vcs / setuptools-scm,
  piot skips the pyproject rewrite (the build backend owns the
  computation). You need to pass the planned version to the build
  backend via an env var, or you'll ship `<pkg>-X.Y.Z.devN.tar.gz`
  instead of `<pkg>-X.Y.Z.tar.gz`. See
  [dynamic versions](/guide/dynamic-versions) for the recipe.

## Pick your library shape

Worked end-to-end examples for the common shapes. Pick the one that matches your repo:

- [**Single-package Python library**](/guide/shapes/python-library) — one `pyproject.toml`, publishing to PyPI. Covers static-version and dynamic-version (`hatch-vcs` / `setuptools-scm`) setups.
- [**Polyglot Rust library** (Rust crate + PyO3 wheel + napi npm)](/guide/shapes/polyglot-rust) — one Rust core, three artifacts (crates.io, PyPI via `maturin`, npm via `napi-rs`).

More shapes will live under [Library shapes](/guide/shapes/) as they're written.

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

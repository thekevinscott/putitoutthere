# Getting started

::: warning Docs being rewritten
The consumer surface is being collapsed to a single reusable GitHub Actions workflow. The "scaffold a `release.yml` and run a CLI" model these docs were originally written against is being removed. Pages will be rewritten as the new surface lands. See [design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md) for the direction.
:::

Put It Out There (piot) is a polyglot release orchestrator. One config file
declares your packages; a reusable GitHub Actions workflow publishes them to
crates.io, PyPI, and npm.

## Does piot fit your library?

piot is a good fit if you can answer **yes** to most of these:

- [ ] Your artifacts publish to some combination of **crates.io, PyPI, and npm** — piot only covers those three registries.
- [ ] You use (or are willing to use) **OIDC trusted publishing** on each registry. Long-lived tokens work as a fallback, but OIDC is the happy path.
- [ ] You build your artifacts in **GitHub Actions**. piot ships as a reusable workflow; that runtime is assumed.
- [ ] You're comfortable with **one tag per package** — defaults to `{name}-v{version}`, or pick your own template via [`tag_format`](/guide/configuration).
- [ ] Your release trigger is **up to you**: merge to `main`, scheduled cron, or manual dispatch all work. See the [nightly release recipe](/guide/nightly-release) for the cron shape.
- [ ] The default bump is **`patch` whenever a package's files change**. Opt into explicit `minor`/`major` bumps (or `skip`) via a [commit trailer](/guide/trailer) — trailers are optional.

piot is probably **not** the right tool if:

- You need a registry piot doesn't cover (Maven, NuGet, Docker Hub, internal registries, etc.).
- You publish from CI systems other than GitHub Actions.
- You need a **build escape hatch** for shapes that don't fit piot's named build modes (`hatch`, `maturin`, `napi`, `bundled-cli`). Examples: `cibuildwheel`, custom `Makefile`s, exotic cross-compile rigs. Write your own release workflow; don't use piot.
- You want **standalone binary archives** attached to GitHub Releases with a curl-installable tarball. That's `cargo-dist`'s / `goreleaser`'s lane; compose with them, don't replace them with piot.
- You need **changelog generation**. Delegate to `release-please` or similar.
- You want **automatic tag rollback** on partial-publish failures. piot deliberately doesn't do this — crates.io is immutable, so deletion isn't safe. Instead piot runs a completeness check before anything ships.

See [Known gaps](/guide/gaps) for the full enumeration of non-goals
and limitations, or [Design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md) for the policy these are derived from.

## Migrating? Read this first

If you already publish to crates.io / PyPI / npm and you're switching
to piot, two things trip up most migrations:

- **The caller workflow filename is load-bearing for OIDC.** crates.io
  and npm pin the caller workflow filename in the OIDC trust policy's
  JWT claim. If your current trusted publisher is registered against
  (say) `patch-release.yml` and your new piot-driven workflow is named
  `release.yml`, publish fails with HTTP 400. Update the trust policy
  on each registry to match your new filename before cutover.
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

Worked examples for the common shapes. Note that shape pages still
describe the prior hand-written-`release.yml` integration model and
will be rewritten as the reusable workflow surface lands.

- [**Single-package Python library**](/guide/shapes/python-library) — one `pyproject.toml`, publishing to PyPI.
- [**Polyglot Rust library** (Rust crate + PyO3 wheel + napi npm)](/guide/shapes/polyglot-rust) — one Rust core, three artifacts.

More shapes at [Library shapes](/guide/shapes/).

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
- [Configuration](/guide/configuration) — every field in the config.
- [Design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md) — what piot is and isn't.

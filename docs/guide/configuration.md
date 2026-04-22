# Configuration

`putitoutthere.toml` lives at the repo root. Schema below.

## `[putitoutthere]`

```toml
[putitoutthere]
version = 1              # required; only 1 is valid today
cadence = "immediate"    # or "scheduled" (cron-triggered releases)
```

## `[[package]]` (one per releasable unit)

Shared fields across every `kind`:

| Field           | Type     | Required | Notes                                             |
|-----------------|----------|----------|---------------------------------------------------|
| `name`          | string   | yes      | Must be unique across the config.                 |
| `kind`          | enum     | yes      | `crates` \| `pypi` \| `npm`.                      |
| `path`          | string   | yes      | Package working dir: `Cargo.toml` (crates), `pyproject.toml` (pypi), or `package.json` (npm). |
| `paths`         | string[] | yes      | Globs that cascade this package.                  |
| `depends_on`    | string[] | no       | Package names this one depends on.                |
| `first_version` | string   | no       | Default `0.1.0`.                                  |

### `kind = "crates"`

| Field                 | Type     | Notes                                                      |
|-----------------------|----------|------------------------------------------------------------|
| `crate`               | string   | Override `name` → crates.io name.                          |
| `features`            | string[] | Pass through to `cargo publish --features`.                |
| `no_default_features` | bool     | Pass `--no-default-features` to `cargo publish` when true. |

Crates are always built on the runner host. There is no cross-target build
matrix — `cargo publish` uploads source to crates.io, which compiles on the
consumer's machine.

### `kind = "pypi"`

| Field     | Type     | Notes                                              |
|-----------|----------|----------------------------------------------------|
| `build`   | enum     | `maturin` \| `setuptools` \| `hatch`. Default `setuptools`. |
| `targets` | string[] | Required when `build = "maturin"`.                 |

### `kind = "npm"`

| Field     | Type     | Notes                                                |
|-----------|----------|------------------------------------------------------|
| `npm`     | string   | Override `name` → npm name (for scoped packages).    |
| `access`  | enum     | `public` \| `restricted`. Default `public`.          |
| `tag`     | string   | dist-tag. Default `latest`.                          |
| `build`   | enum     | `napi` \| `bundled-cli`. Omitted = vanilla.          |
| `targets` | string[] | Required when `build ∈ {napi, bundled-cli}`.         |

## Example

```toml
[putitoutthere]
version = 1

[[package]]
name = "my-rust"
kind = "crates"
path = "crates/my-rust"
paths = ["crates/my-rust/**"]

[[package]]
name = "my-py"
kind = "pypi"
path = "py/my-py"
paths = ["py/my-py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
depends_on = ["my-rust"]
```

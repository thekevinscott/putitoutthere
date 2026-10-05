# `bundle_cli` Linux binaries compiled as static musl

**Summary.** `bundle_cli`'s Linux cross-compile step previously ran
`cargo build --target $TARGET` directly on the GitHub-hosted runner.
That runner's glibc (currently 2.39 on Ubuntu 24.04) got baked into
the produced binary as a hard runtime requirement, so any older Linux
at install time failed with `./bin: /lib/x86_64-linux-gnu/libc.so.6:
version 'GLIBC_2.39' not found`. The fix derives a `BINARY_TARGET`
from `matrix.target` by substituting `-linux-gnu*` → `-linux-musl*`
and uses that for the three workflow steps that touch the binary's
compile triple. Statically-linked musl binaries have no glibc floor.
The package's declared target triple (used for npm platform-package
names, napi builds, wheel tags, artifact names) is unchanged; only
the binary inside switches compile triple.

**Required changes.** None for the common case — the workflow makes
the swap automatically. The exception: CLI crates that
dynamic-link a system C library through default cargo features will
see a linker error on the first release after upgrade. The static
musl build cannot satisfy a dynamic link against the host's glibc-world
libraries. The fix is a one-line `Cargo.toml` change per case:

| Symptom (cargo error mentions) | Fix in your CLI's `Cargo.toml` |
|--------------------------------|--------------------------------|
| `openssl-sys`, `libssl.so`, OpenSSL          | Switch to `rustls` (`reqwest = { default-features = false, features = ["rustls-tls"] }`), or pin `openssl = { features = ["vendored"] }` |
| `git2`, `libgit2`              | `git2 = { features = ["vendored-openssl", "vendored-libgit2"] }` |
| `libsqlite3-sys`, SQLite       | `rusqlite = { features = ["bundled"] }` (or `libsqlite3-sys = { features = ["bundled"] }`) |
| `libpq`, Postgres client       | Swap `postgres-native-tls` for `postgres-rustls`, or use `sqlx` with the `rustls` feature |
| `libmysqlclient`, MySQL client | Same — prefer a pure-Rust client; `mysqlclient-sys` has no clean static path |

The musl build fails loudly at release time when one of these is
missed — there is no silent broken-binary failure mode. A blocked
release is the worst outcome.

**Deprecations removed.** None.

**Behavior changes without code changes.** The bundled binary inside
a Linux package built before this release required the build
runner's glibc (currently 2.39); after this release it has no glibc
requirement and runs on any Linux ≥ kernel 3.2, including Alpine,
NixOS in musl mode, scratch containers, and any host whose glibc is
older than the build runner's. Package identifiers (npm platform-
package names like `@scope/cli-linux-x64-gnu`, PyPI wheel tags,
artifact upload names) are unchanged — the substitution applies only
to the binary's compile triple.

**Verification.** Install a `bundle_cli`-enabled package from any
pre-Ubuntu-24.04 Linux (Ubuntu 22.04, Debian 12, Amazon Linux 2,
Alpine) and run the CLI — no `GLIBC_2.x not found` error. On the
build side, the cargo invocation in CI now prints
`cargo build --release --target x86_64-unknown-linux-musl ...`
instead of `-gnu` for Linux rows; `file` on the produced binary
reports `statically linked` instead of `dynamically linked`.

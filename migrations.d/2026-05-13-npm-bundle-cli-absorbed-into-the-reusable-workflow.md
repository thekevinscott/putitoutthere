# `npm` `bundle_cli` absorbed into the reusable workflow

**Summary.** `kind = "npm"` packages with `build = "bundled-cli"`
no longer need to author a `scripts/build.cjs` that performs the
Rust cross-compile by hand. Declare `[package.bundle_cli]` in
`putitoutthere.toml` — same schema as the pypi/maturin block from
#282, minus `stage_to` (npm staging is determined entirely by the
matrix row's `artifact_path`) — and the reusable workflow runs
`rustup target add`, `cargo build --release --target <triple>
--bin <bin>` against `crate_path`, and the copy-into-staging step
itself. A defense-in-depth build-content guard asserts the staged
binary exists before `actions/upload-artifact` runs, so a broken
row never leaves the build runner. Mirror of the pypi wiring landed
in #282; closes the seam that #287 patched (env-var contract
between the consumer's build script and the engine).

**Required changes.** None for additive adoption. To migrate an
existing consumer with a hand-written `scripts/build.cjs`:

Before (`putitoutthere.toml`):

```toml
[[package]]
name    = "my-cli"
kind    = "npm"
build   = "bundled-cli"
path    = "packages/ts-cli"
globs   = ["packages/ts-cli/**", "crates/my-cli/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  # ...
]
```

`scripts/build.cjs` (consumer-owned):

```js
const { execFileSync } = require('node:child_process');
const { mkdirSync, copyFileSync } = require('node:fs');
const target = process.env.TARGET;
if (!target || target === 'main' || target === 'noarch') process.exit(0);
const binName = 'my-cli';
const ext = target.includes('windows') ? '.exe' : '';
execFileSync('rustup', ['target', 'add', target], { stdio: 'inherit' });
execFileSync('cargo', ['build', '--release', '--target', target, '--bin', binName],
  { cwd: '../../crates/my-cli', stdio: 'inherit' });
mkdirSync(`build/${target}`, { recursive: true });
copyFileSync(`../../crates/my-cli/target/${target}/release/${binName}${ext}`,
  `build/${target}/${binName}${ext}`);
```

`package.json` (consumer-owned):

```json
{ "scripts": { "build": "tsc && node scripts/build.cjs" } }
```

After (`putitoutthere.toml`):

```toml
[[package]]
name    = "my-cli"
kind    = "npm"
build   = "bundled-cli"
path    = "packages/ts-cli"
globs   = ["packages/ts-cli/**", "crates/my-cli/**"]
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  # ...
]

[package.bundle_cli]
bin        = "my-cli"
crate_path = "crates/my-cli"
# features            = ["cli"]     # if the binary is feature-gated
# no_default_features = false
```

`scripts/build.cjs`: **deleted.** The `build` script in
`package.json` typically becomes `"tsc"` (or whatever your
TypeScript launcher build was minus the `node scripts/build.cjs`
half).

**During migration both shapes coexist.** A consumer that still
ships `scripts/build.cjs` keeps working — the workflow's cargo
build runs first, then `npm run build --if-present` runs the
consumer's script (which sees `build/<triple>/` already populated
and probably no-ops). There's no transitional broken state and
no flag to set.

**Constraint.** The binary must build with a vanilla
`cargo build --release --target <triple> --bin <bin>` from
`crate_path`. Optional `features` / `no_default_features` cover
the `[[bin]] required-features = ["cli"]` shape. Crates that need
arbitrary env vars, alternate manifests, Zig-cc cross
toolchains, or other cargo flags don't fit the recipe and
should keep their own release workflow.

**Deprecations removed.** None.

**Behavior changes without code changes.** Existing consumers
without `[package.bundle_cli]` declared are unaffected — the
workflow's cargo build / stage / guard steps are gated on
`matrix.bundle_cli` being set, so consumers who still rely on
their hand-written `scripts/build.cjs` see the byte-identical
build matrix they saw before. The schema rejects `bundle_cli`
declared on a non-bundled-cli npm package (or with empty
`targets`), so a typo can't make the block silently inert.

**Verification.** After upgrading, switch one consumer's
`putitoutthere.toml` to declare `[package.bundle_cli]` and
remove the `node scripts/build.cjs` half of their `build` script.
The next release run's build job will, for each per-target row,
include three new step lines: `bundle_cli — add Rust target`,
`bundle_cli — cargo build for <triple> (<bin>)`, and
`bundle_cli — stage binary into <artifact_path>`, followed by
the `bundle_cli — verify <artifact_path>/<bin>` guard before
`Upload artifact`. The published per-platform tarball, when
downloaded and unpacked, contains the cross-compiled binary at
the same path the launcher resolves it from.

---

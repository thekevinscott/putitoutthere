# npm build step: TARGET / BUILD env vars

**Summary.** The reusable workflow's `_matrix.yml` and `release.yml`
now set `TARGET=${{ matrix.target }}` and `BUILD=${{ matrix.build }}`
on the `matrix.kind == 'npm'` build step (and `TARGET=main BUILD=`
on `release.yml`'s publish-job rebuild loop, which only ever runs
for the main package's row). Bundled-CLI / napi consumers' build
scripts read these env vars to know which triple to cross-compile
and which build mode is active; without them, every per-platform
matrix row produced an empty `build/<triple>/` directory and
`actions/upload-artifact@v7` reported
`No files were found with the provided path: ...`. The internal
`e2e-fixture-job.yml` already passed `TARGET` / `BUILD` for the
`js-bundled-cli` fixture, so the fixture suite was green while the
shape it advertised was broken for real consumers. Tracked at #287;
hit in the wild on `thekevinscott/darkfactory`'s first release.

The README's [Bundled-CLI npm family](../README.md#bundled-cli-npm-family)
recipe gained the consumer-side build-script contract that was
previously missing: a documented `scripts/build.cjs` template
that reads `TARGET`, runs `rustup target add` + `cargo build`
+ stage-into-`build/<triple>/`, and no-ops on
`TARGET=main`. Without that section, consumers had to read the
`js-bundled-cli` test fixture or experiment to discover the
contract.

**Required changes.** None for consumers whose existing build
script either ignored `TARGET` or used a different env var name —
those scripts now get the `TARGET` / `BUILD` exports too but
nothing forces them to read. To start using the contract, mirror
the README's `scripts/build.cjs` shape and reference it from
`package.json`'s `scripts.build` field. Existing fixtures and
the engine's contract are unchanged.

**Deprecations removed.** None.

**Behavior changes without code changes.** The npm build step
now runs with `TARGET` and `BUILD` set in its environment.
Build scripts that previously saw `undefined` and either crashed
or silently no-oped will now see a defined string. Vanilla npm
consumers (no `build = "bundled-cli" | "napi"`) see
`TARGET=main BUILD=` (or `BUILD=undefined` on rows that don't
declare a build mode); their build scripts that don't read either
var are unaffected.

**Verification.** A bundled-cli consumer following the README
recipe sees their per-platform matrix rows produce non-empty
artifacts: each `<pkg>-npm-<triple>` upload contains
`build/<triple>/<bin-name>`. The release run's `Upload artifact`
step no longer logs `No files were found with the provided path`
for any npm row.

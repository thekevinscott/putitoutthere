# Bundled-CLI launcher generation no-ops without `[package.bundle_cli]`

**Summary.** #299 moved npm bundled-cli launcher generation into the
engine and invoked it on every bundled-cli package's main row.
`writeLauncherFromConfig` assumed `[package.bundle_cli]` was always
present and dereferenced `bundle_cli.bin` unconditionally, so a
bundled-cli npm package that omits the table — the legacy
"bring-your-own `scripts/build.cjs` + hand-authored `bin/<bin>.js`"
shape that #298 explicitly kept opt-in — crashed the release at the
`write-launcher` step with `Cannot read properties of undefined
(reading 'bin')`. Launcher generation now no-ops when the table is
absent, mirroring the cross-compile step's existing `matrix.bundle_cli`
gate. The gate lives in the engine, not the workflow `if:`, because the
main row the step runs on never carries `bundle_cli` (`plan.ts` attaches
it only to per-target bundled-cli rows).

**Required changes.** None. A bundled-cli package that declares
`[package.bundle_cli]` is unchanged — the engine still generates
`bin/<bin>.js` and the `package.json#bin` entry. A package that omits
the table and ships its own launcher (the legacy path) no longer crashes;
the engine leaves its launcher alone. A consumer that *intended* the
declarative path and simply forgot the table should add it — the
cross-compile and launcher generation both key off it:

| Before | After |
|--------|-------|
| `build = "bundled-cli"`, `targets = [...]`, no `[package.bundle_cli]` → `write-launcher` TypeError | release succeeds; add `[package.bundle_cli]` with at least `bin` to opt into engine cross-compile + launcher generation |

**Deprecations removed.** None.

**Behavior changes without code changes.** A bundled-cli npm package
without `[package.bundle_cli]` previously failed its release at the
`write-launcher` step (as of #299); it now completes, with the engine
authoring no launcher for it.

**Verification.** Trigger a release for a bundled-cli npm package that
omits `[package.bundle_cli]`: the run completes (previously it failed at
the `write-launcher` step). A package that declares the table still gets
its engine-generated launcher.

# Bundled-cli staged binary is executable

**Summary.** For `kind = "npm"` packages with a `build = "bundled-cli"`
entry, the reusable workflow cross-compiles the CLI and stages it into
a per-triple platform package (`@scope/cli-<triple>`). The staged
binary was packed with mode `0644` — no executable bit. npm only sets
the executable bit on `bin` entries; the bundled binary is referenced
via `package.json#main`, so npm never `chmod`s it, and the bit it had
on the build runner is stripped crossing the GitHub Actions artifact
upload/download boundary. At runtime the generated launcher's
`spawnSync` of the resolved binary failed with `EACCES`. The workflow
now `chmod +x`es the staged binary for non-Windows targets before the
platform package is packed/published.

**Required changes.** None. The fix is internal to the reusable
workflow's npm bundled-cli publish path.

**Deprecations removed.** None.

**Behavior changes without code changes.** Per-triple platform
packages published for non-Windows targets now ship the CLI binary
with mode `0755` instead of `0644`. Consumers who already worked
around the bug (a `postinstall` `chmod`, or a launcher that `chmod`s
before `spawnSync`) can drop that workaround; leaving it in place is
harmless.

**Verification.** Publish a `build = "bundled-cli"` npm family, then
`npm install` it and run the CLI — `npx <bin> --version` succeeds
instead of failing with `spawnSync ... EACCES`. Inspecting the
published platform tarball
(`tar -tvzf` on the `@scope/cli-<triple>` `.tgz`) shows the binary as
`-rwxr-xr-x`.

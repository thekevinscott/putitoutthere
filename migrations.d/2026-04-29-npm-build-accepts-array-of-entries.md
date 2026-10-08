# npm `build` accepts array of entries

**Summary.** `kind = "npm"` packages can now declare `build` as an array
of entries to publish multiple per-platform package families from a
single main package — for example, a napi-rs Node addon plus a CLI
binary, both selected via `optionalDependencies` on a shared top-level
package. Each entry has a `mode` (`napi` / `bundled-cli`) and an
optional `name` template (e.g. `"@scope/lib-{triple}"`) that the
consumer fully controls. The previous single-mode string form is
preserved.

**Required changes.** None. `build = "napi"` and `build = "bundled-cli"`
keep producing the same per-platform package names, the same artifact
directory layout, and the same matrix shape they did before. Adopt the
array form only if you need a multi-family npm package.

| Field | Before | After |
|---|---|---|
| `build` (single mode) | `build = "napi"` | unchanged — `build = "napi"` still valid |
| `build` (single mode, array form) | _new_ | `build = ["napi"]` — equivalent to the string form |
| `build` (single mode, custom name) | _new_ | `build = [{ mode = "napi", name = "@scope/lib-{triple}" }]` |
| `build` (multi mode) | _new_ | `build = [{ mode = "napi", name = "@scope/lib-{triple}" }, { mode = "bundled-cli", name = "@scope/cli-{triple}" }]` |

Variables in `name` templates: `{name}`, `{scope}`, `{base}`,
`{triple}`, `{mode}`. `{triple}` is required in every template.
`{version}` is not surfaced — platform package names are immutable
identifiers; the version is pinned via `optionalDependencies`.

**Validation rules** enforced at config load:

- Each `mode` value (`napi`, `bundled-cli`) appears at most once per package.
- Every `name` template must contain `{triple}`.
- Unknown placeholders are rejected.
- Templates across entries must be pairwise distinct (collision-free).

**Multi-mode artifact layout.** When `build` has more than one entry,
the build-side artifact directory and path get a mode infix to keep
families separate:

```
artifacts/
  my-cli-napi-linux-x64-gnu/         # napi family
  my-cli-bundled-cli-linux-x64-gnu/  # bundled-cli family
```

The build job for a multi-mode row writes to
`<pkg.path>/build/<mode>-<triple>/`. Single-mode (string form or
length-1 array) still uses `<pkg.path>/build/<triple>/` —
byte-for-byte unchanged.

**Trusted-publisher registrations.** Each platform package across
*every* family needs its own npm trusted-publisher registration. A
multi-mode package with N families × M targets needs N×M registrations
plus one for the top-level. There's no shorthand on npm's side; this
is the cost of the dual-family install pattern.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for single-mode
configs. Multi-mode is new surface — no prior behavior to compare
against.

**Verification.** For an existing single-mode config, `putitoutthere
plan` should emit identical matrix rows before and after the upgrade
(same `artifact_name`, same `artifact_path`, same `target`). For a
new multi-mode config, you should see one matrix row per `(mode,
triple)` plus a single `target = "main"` row, and the matrix
`artifact_name` should carry the mode infix
(`<name>-<mode>-<triple>`).

---

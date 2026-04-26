# Artifact contract

::: warning Page being rewritten
This page exists because consumers wrote their own `release.yml` and had to honor the artifact-naming contract by hand. Once the reusable workflow ships, the contract is internal and consumers don't see it. The grammar here documents what the engine emits and expects, which is unchanged. See [design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md).
:::

piot's `publish` phase reads pre-built artifacts off disk. This page is
the contract: **what files it expects, under which directory names,
produced by which build step.** If the build phase uploads under the
right name, piot picks the files up and ships them. If it doesn't, the
publish phase fails the pre-publish completeness check with:

```
putitoutthere: Artifact completeness check failed:
  <pkg>: <slot>: missing artifact directory <expected-dir>/
```

This page exists so you don't have to reverse-engineer
`<expected-dir>` from the error.

## The flow

```
build job:    actions/upload-artifact@v4   name: <artifact-name>   path: <built files>
                              │
                              ▼
publish job:  actions/download-artifact@v4 path: artifacts          ← always "artifacts"
                              │
                              ▼
              artifacts/<artifact-name>/<file-1>
              artifacts/<artifact-name>/<file-2>
              ...
                              │
                              ▼
              piot's publish phase      reads artifacts/<artifact-name>/
```

Two contracts together:

1. **Upload name.** Whatever you pass as `name:` to
   `upload-artifact@v4` becomes the directory name after download.
2. **Download path.** Always `artifacts` (set on `download-artifact@v4`
   in the publish job). piot looks for files under
   `artifacts/<artifact-name>/`.

The reusable workflow wires both internally. The naming convention
below documents the engine's invariants.

## Use `matrix.artifact_name` and `matrix.artifact_path` verbatim

piot's `plan` job emits both fields on every matrix row. **They are
the source of truth.** Plug them straight into `upload-artifact@v4`:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: ${{ matrix.artifact_name }}
    path: ${{ matrix.artifact_path }}
```

Do **not** substitute your own glob (`dist/`, `dist/*.tar.gz`,
`./build/**`) — `matrix.artifact_path` already points at the directory
your build tool wrote into, and `matrix.artifact_name` already encodes
the per-package + per-target naming the publish job expects.

If you ran `uv build`, `python -m build`, `npm pack`, or `cargo
package`, the output landed in the directory `matrix.artifact_path`
references. Upload that directory under `matrix.artifact_name` and
piot finds it.

## Naming convention reference

The grammar piot's `plan` emits and the publish phase expects:

| `kind`   | `build`                       | Slot                         | `artifact_name`                          | Files inside                          |
|----------|-------------------------------|------------------------------|------------------------------------------|---------------------------------------|
| `pypi`   | `setuptools` / `hatch`        | sdist                        | `<pkg.name>-sdist`                       | `<pypi-name>-<version>.tar.gz`        |
| `pypi`   | `maturin`                     | sdist                        | `<pkg.name>-sdist`                       | `<pypi-name>-<version>.tar.gz`        |
| `pypi`   | `maturin`                     | per-target wheel             | `<pkg.name>-wheel-<target>`              | `<pypi-name>-<version>-*.whl`         |
| `crates` | —                             | crate tarball *(optional)*   | `<pkg.name>-crate`                       | `<pkg.name>-<version>.crate`          |
| `npm`    | (none)                        | tarball                      | `<pkg.name>-tarball`                     | `<pkg.name>-<version>.tgz`            |
| `npm`    | `napi` / `bundled-cli`        | per-target sub-package       | `<pkg.name>-<target>`                    | the per-target package directory tree |
| `npm`    | `napi` / `bundled-cli`        | top-level (optionalDeps)     | `<pkg.name>-main`                        | the top-level package directory tree  |

Notes:

- `<pkg.name>` is the `name` field on the `[[package]]` block — *not*
  the registry name (`pypi = "..."`, `crate = "..."`,
  `npm = "..."`) when those differ. The artifact directory name uses
  the piot identifier; the file *inside* uses the registry name.
- `<target>` is the Rust-style triple (`x86_64-unknown-linux-gnu`,
  `aarch64-apple-darwin`, etc.) for maturin / napi / bundled-cli rows.
- **Slashes in `<pkg.name>` are encoded.** `actions/upload-artifact@v4`
  forbids `/` in artifact names, so the planner encodes each `/` to
  `__` before emitting `artifact_name`. A package named `py/cachetta`
  produces `artifacts/py__cachetta-sdist/…` — one flat directory, not
  a nested `py/cachetta-sdist/`. The encoding is automatic; pass the
  matrix `artifact_name` field through to `upload-artifact` verbatim
  (as the [worked examples](#worked-examples) do) and the round-trip
  works. piot's config loader rejects `__` in `pkg.name` so the
  encoding stays unambiguous. Other upload-artifact-forbidden
  characters (`\`, `:`, `<`, `>`, `|`, `*`, `?`, `"`) are rejected at
  config load — they have no realistic identifier use and would also
  break registry naming.
- crates.io takes source on upload; the `<pkg.name>-crate` slot is
  optional and only checked if you pre-package via `cargo package`.
  Most repos let `cargo publish` build from source on the publish
  runner and skip the upload entirely.

## Worked examples

### Plain Python sdist (`uv build` / `python -m build`)

```yaml
build:
  needs: plan
  strategy:
    matrix:
      include: ${{ fromJSON(needs.plan.outputs.matrix) }}
  runs-on: ${{ matrix.runs_on }}
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - uses: astral-sh/setup-uv@v3
    - name: Build sdist
      working-directory: ${{ matrix.path }}
      run: uv build --sdist
    - uses: actions/upload-artifact@v4
      with:
        name: ${{ matrix.artifact_name }}      # e.g. "my-lib-sdist"
        path: ${{ matrix.artifact_path }}      # e.g. "packages/python/dist"
```

After `download-artifact@v4` with `path: artifacts`, the publish job
sees:

```
artifacts/my-lib-sdist/my-lib-0.2.13.tar.gz
```

### maturin per-target wheel

Prefer a directory `path:` over a glob — `actions/upload-artifact@v4`
preserves the workspace-relative path under a glob, which produces
nested layouts the publish job's reader has to walk through:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: my-py-wheel-${{ matrix.target }}     # e.g. "my-py-wheel-x86_64-unknown-linux-gnu"
    path: target/wheels                        # directory; contents land flat under <name>/
```

Publish job sees:

```
artifacts/my-py-wheel-x86_64-unknown-linux-gnu/my_py-0.4.1-cp312-cp312-manylinux_2_17_x86_64.whl
```

(The publish-side reader walks recursively, so glob `path:` values
that produce `<name>/target/wheels/*.whl` still work — but the
directory shape keeps the on-disk layout flat and predictable.)

### napi per-target sub-package

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: my-tool-${{ matrix.target }}
    path: npm/${{ matrix.target }}             # the synthesised sub-package dir
```

Publish job sees `artifacts/my-tool-x86_64-unknown-linux-gnu/` as a
ready-to-`npm publish` package directory.

## Diagnosing a missing-artifact error

When the completeness check fails:

```
putitoutthere: Artifact completeness check failed:
  py/cachetta: sdist: missing artifact directory py__cachetta-sdist/
```

Walk it back through the flow:

1. **What did `plan` emit for `artifact_name`?** Inspect the `plan`
   job's output matrix in the Actions log. The row for the failing
   slot has the exact `artifact_name` field — that string is the
   directory name the publish job will look for.
2. **Did the build job upload under that name?** Open the build job
   log for the same row, find the `actions/upload-artifact` step, and
   confirm the `name:` parameter matches.
3. **Did the publish job download?** Confirm the publish job's
   `actions/download-artifact@v4` step has `path: artifacts` (no
   per-name override). If `path:` is set to anything else, piot's
   reader is looking in the wrong place.
4. **Did the build step actually produce files?** A successful upload
   of an empty directory is the silent failure mode. Add an `ls` of
   the directory referenced by `matrix.artifact_path` immediately
   before the upload step to confirm the build wrote what you think
   it did.

## Related

- [Troubleshooting publish failures](/guide/troubleshooting) — the
  full error-string → fix index.
- [npm platform packages](/guide/npm-platform-packages) — the per-
  target + top-level slot grammar for napi / bundled-cli.
- [Library shapes](/guide/shapes/) — every shape page shows the
  upload step in context.

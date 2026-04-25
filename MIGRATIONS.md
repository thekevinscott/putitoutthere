# Migration guide

How to upgrade between versions of `putitoutthere`. Sections are ordered
newest-first; each one is self-contained. Every observable change to
public API gets a section — additive changes as well as breaking ones —
because versioning is not yet strictly semver.

Each section covers five things, in order:

1. **Summary** — what changed and why.
2. **Required changes** — before/after diffs for config, CLI flags, and
   action inputs.
3. **Deprecations removed** — anything previously warned about that is
   now gone.
4. **Behavior changes without code changes** — same API, different
   runtime behavior (tag format, exit codes, default values).
5. **Verification** — commands you can run to confirm the upgrade
   worked, with the expected output.

---

## Unreleased

### Scaffolded `release.yml` now forwards `GITHUB_TOKEN`

**Summary.** piot has supported cutting a GitHub Release alongside each
tag push since #26, but the scaffolded `release.yml` template never
forwarded `GITHUB_TOKEN` to the publish step. GitHub Actions does not
auto-mount the runner token as an env var — `permissions: contents:
write` only grants the token *scope* to write Releases; the token still
has to be exposed via `env:` for piot's `release.ts` to read it from
`process.env.GITHUB_TOKEN`. Without it, piot silent-skipped Release
creation and consumers got tags but no Release entries on the repo's
Releases page. Fresh `piot init` runs now scaffold the env line.

**Required changes.** Existing repos that ran `piot init` before this
change need a one-line addition to `.github/workflows/release.yml`:

```diff
       - uses: thekevinscott/putitoutthere@v0
         with:
           command: publish
           dry_run: ${{ inputs.dry_run || 'false' }}
         env:
           NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
           CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_TOKEN }}
           PYPI_API_TOKEN: ${{ secrets.PYPI_API_TOKEN }}
+          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The publish job already declares `permissions: contents: write`, which
is the scope GitHub's runner-supplied `GITHUB_TOKEN` needs to create
Releases — no additional permission changes required.

**Deprecations removed.** None.

**Behavior changes without code changes.** Repos that adopt the new
template (or apply the diff above) start seeing GitHub Release entries
appear under `https://github.com/<owner>/<repo>/releases` after each
publish. The Release body is the output of `git log
<prev-tag>..<this-tag> --format='- %s' --no-merges`. Tags suffixed with
`-rc`, `-beta`, or `-alpha` are flagged `prerelease: true`. Release
creation is best-effort: a 4xx/5xx from the GitHub API surfaces as a
`publish: GitHub Release creation failed` warning but does not fail the
publish run — the registry publish and tag push remain authoritative.

**Verification.** After the next release run on a repo that adopted the
fix:

```bash
# Inspect the publish job log:
#   "publish: GitHub Release created at https://github.com/.../releases/tag/<name>-v<x.y.z>"

# Or hit the API directly:
gh release view <name>-v<x.y.z> --repo <owner>/<repo>
```

If you previously saw the warning `publish: GitHub Release creation
failed` in your publish logs, the warning should be gone and the
Releases page should populate.

### Package names with `/` no longer need an encode/decode workaround

**Summary.** Polyglot-monorepo repos that group packages by language
(e.g. `name = "py/foo"`, `"js/bar"`) used to fail at the build job
with:

```
The artifact name is not valid: py/foo-sdist.
Contains the following character: Forward slash /
```

…because `actions/upload-artifact@v4` forbids `/` in artifact names
and the planner emitted `artifact_name` verbatim from `pkg.name`
([#230](https://github.com/thekevinscott/putitoutthere/issues/230)).
The planner now encodes each `/` to `__`
(`py/foo` → `py__foo-sdist`), so the build job's
`name: ${{ matrix.artifact_name }}` works without modification.

**Required changes.**

- **None for repos with slash-free `pkg.name`** — `artifact_name`
  is byte-identical to the previous version.
- **Repos that ran the [`cachetta#26`-style](https://github.com/thekevinscott/cachetta/pull/26)
  encode/decode workaround should remove it.** The planner now
  does the encoding natively; leaving the workaround in place
  produces double-encoded names like `py____foo-sdist`, which the
  publish-side reader will treat as a missing artifact.

  ```diff
   - uses: actions/upload-artifact@v4
     with:
  -    name: ${{ format('{0}', matrix.artifact_name) }}  # any sed/format encode
  -    path: ${{ matrix.artifact_path }}
  +    name: ${{ matrix.artifact_name }}                 # use the field as-is
  +    path: ${{ matrix.artifact_path }}
  ```

  ```diff
   - uses: actions/download-artifact@v4
     with:
       path: artifacts
  - - name: Decode artifact dir names
  -   run: |
  -     # rename artifacts/py__foo-sdist back to artifacts/py/foo-sdist
  -     ...
  ```

**Deprecations removed.** None.

**Behavior changes without code changes.**

- `pkg.name` containing `__` (the new encoding sequence) is now
  rejected at config load with: `package name must not contain "__"
  (reserved: piot encodes "/" to "__" for artifact-name slots; pick
  a different separator)`. If your config uses `__` in a package
  name today, rename to use `-` or `_` and update any tags / consumer
  references; piot can't safely sanitize it without ambiguity.
- `pkg.name` containing `\`, `:`, `<`, `>`, `|`, `*`, `?`, or `"`
  is now rejected at config load. None of these are valid in npm,
  PyPI, or crates.io names, so any config that previously contained
  them was already broken at publish time — the change just moves
  the failure earlier with a clearer message.

**Verification.**

```sh
putitoutthere plan --json | jq '.[].artifact_name'
```

Expect every emitted `artifact_name` to contain only ASCII letters,
digits, `-`, `_`, and `.` — no `/` and no other forbidden chars.
For a repo with `name = "py/cachetta"`:

```
"py__cachetta-sdist"
"py__cachetta-wheel-x86_64-unknown-linux-gnu"
```

After the next release, the build job's `actions/upload-artifact@v4`
step uploads under `py__cachetta-sdist/` (a single flat directory
under `artifacts/`), and piot's publish-side reader consumes the
same path.

### Python shape examples now use `uv build`

**Summary.** Documentation examples for the Python library, Python
cibuildwheel, and dynamic-versions shapes switched the sdist-build
step from `python -m build --sdist` to `uv build --sdist`. piot's
contract is unchanged — backends, artifact names, the
`matrix.artifact_name` / `matrix.artifact_path` fields, and the
publish-side completeness check all work identically. The change
removes a `pip install build` round-trip and aligns the docs with
`uv` as the recommended Python toolchain.

**Required changes.** None. `python -m build` still works. To
follow the new examples in your own `release.yml`:

```diff
 build:
   ...
   steps:
-    - uses: actions/setup-python@v5
-      with: { python-version: '3.12' }
     - name: Build sdist
-      run: |
-        cd ${{ matrix.path }}
-        python -m pip install build
-        python -m build --sdist --outdir dist
+      working-directory: ${{ matrix.path }}
+      run: uv build --sdist
+    # uv installs and manages Python itself; no setup-python step needed.
+    # Add this once at the top of the build job:
+    - uses: astral-sh/setup-uv@v3
```

`uv build --sdist` writes to `dist/` inside the working directory
(same as `python -m build --outdir dist`), so
`matrix.artifact_path` keeps pointing at the right place. The
publish job is unchanged — `setup-python` + `pip install twine` is
still the recommended path there because piot's PyPI handler shells
out to `twine`.

**When *not* to follow this example.** Stay on `python -m build`
if:

- Your CI image already has Python pre-installed and adding
  `setup-uv` would slow the cold cache.
- Your `pyproject.toml` exercises a build backend feature that uv's
  isolated build environment doesn't yet handle (rare; uv's build
  isolation matches `python -m build`'s).
- Your team's runbook standardises on `python -m build` and the
  consistency cost of switching outweighs the per-run speedup.

`python -m build` is not deprecated and will keep working.

**Deprecations removed.** None.

**Behavior changes without code changes.** None.

**Verification.**

```bash
# After the build job runs:
ls artifacts/<pkg.name>-sdist/
# Expected: <pypi-name>-X.Y.Z.tar.gz   (no .devN suffix)
```

If you see the expected sdist, the switch worked. If you see a
`.devN` suffix, your project uses dynamic versioning — see
[dynamic versions](https://thekevinscott.github.io/putitoutthere/guide/dynamic-versions)
for the env-var handoff (unchanged by this migration).

### Repository renamed `put-it-out-there` → `putitoutthere`

**Summary.** The GitHub repository slug collapsed from `put-it-out-there`
to `putitoutthere`, matching the npm package and CLI binary name. The
human-readable name "Put It Out There" (with spaces) is unchanged. GitHub
auto-redirects the old URL, but any place a consumer has hard-coded the
old slug — npm/Cargo/pyproject `repository` URLs, GitHub Actions
references, OIDC trust policy `repository:` claims, docs links — should
be updated.

**Required changes.**

```diff
 # package.json (or Cargo.toml / pyproject.toml)
-"repository": "https://github.com/<owner>/put-it-out-there"
+"repository": "https://github.com/<owner>/putitoutthere"
```

```diff
 # .github/workflows/release.yml — if you reference the action by full repo path
-uses: thekevinscott/put-it-out-there/.github/actions/<...>
+uses: thekevinscott/putitoutthere/.github/actions/<...>
```

```diff
 # OIDC trust policies (PyPI, npm) that gate on the source repo
-"repository": "<owner>/put-it-out-there"
+"repository": "<owner>/putitoutthere"
```

If you only ever invoked `putitoutthere` via the npm package
(`npx putitoutthere`, `pnpm add -D putitoutthere`) or the published
GitHub Action, no change is required — those references already used the
collapsed name.

**Deprecations removed.** None. The old slug continues to redirect at
the GitHub layer.

**Behavior changes without code changes.**

- Documentation site moved from
  `https://thekevinscott.github.io/put-it-out-there/` to
  `https://thekevinscott.github.io/putitoutthere/`. The old URL
  redirects.
- `git remote -v` will still show the old URL until you `git remote
  set-url origin https://github.com/thekevinscott/putitoutthere.git`.
  Push and fetch keep working via redirect, but updating the remote
  avoids surprise breakage if the redirect is ever retired.

**Verification.**

```sh
# Confirm no stale references in your repo
grep -r "put-it-out-there" .
```

Expect no hits outside historical changelog/migration entries.

### `[package.bundle_cli]` — stage a Rust CLI into every maturin wheel (#217)

**Summary.** New optional sub-table under `[[package]]` for pypi packages
that want the `ruff` / `uv` / `pydantic-core` wheel shape: a companion
Rust CLI binary, cross-compiled per target and staged into the Python
source tree before maturin runs, so each wheel ships the binary as
package data and `pip install <pkg>` gets a working CLI on `PATH` with
no Rust toolchain on the user's machine. Additive — existing
configurations are unchanged.

**Required changes.** None for existing configs. To opt in:

```diff
 [[package]]
 name       = "my-py"
 kind       = "pypi"
 build      = "maturin"
 path       = "packages/python"
 paths      = ["packages/python/**"]
 targets    = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
+
+[package.bundle_cli]
+bin        = "my-cli"
+stage_to   = "src/my_py/_binary"
+crate_path = "crates/my-rust"   # defaults to "." (repo workspace root)
```

And in the Python package's `pyproject.toml`:

```diff
+[project.scripts]
+my-cli = "my_py._binary:entrypoint"    # small os.execv launcher stub
+
 [tool.maturin]
-include = ["..."]
+include = ["...", "src/my_py/_binary/**"]  # ship the staged binary
```

See [Polyglot Rust library → Shipping a Rust CLI inside the PyPI wheel](https://github.com/thekevinscott/putitoutthere/blob/main/docs/guide/shapes/polyglot-rust.md#shipping-a-rust-cli-inside-the-pypi-wheel)
for the full worked example including the launcher stub.

**Deprecations removed.** None.

**Behavior changes without code changes.** None for existing configs.
Packages that declare `[package.bundle_cli]` get two new steps emitted
in the scaffolded build job (`Setup Rust (if pypi bundle_cli)` +
`Build + stage bundled CLI`), both gated on
`matrix.kind == 'pypi' && matrix.bundle_cli.bin != '' && matrix.target != 'sdist'`
so packages without the block see no change.

**Verification.** For a repo that opts in:

```bash
# After piot's build job runs on one target:
ls packages/python/src/my_py/_binary/
# Expected: my-cli  (or my-cli.exe on Windows targets)

# After the wheel is built:
python -m zipfile -l packages/python/dist/*.whl | grep _binary
# Expected: one entry per target listing the staged binary.

# End-to-end on a released wheel:
pip install my-py==<published-version>
which my-cli
my-cli --version
```

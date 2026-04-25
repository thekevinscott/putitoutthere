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

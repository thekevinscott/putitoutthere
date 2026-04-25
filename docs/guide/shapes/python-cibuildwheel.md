# Python wheels with C/C++ extensions (cibuildwheel)

This page is for Python libraries that ship **compiled C, C++, or
Cython extensions** packaged as platform-specific wheels — the
shape used by `pillow`, `lxml`, `numpy`, `scipy`, `pandas`, and
most of the scientific Python stack. The build tool of choice is
[`cibuildwheel`](https://cibuildwheel.pypa.io/), which compiles
your extension across the full Python × OS × architecture matrix
and emits one wheel per cell.

If your extension is in **Rust** via PyO3, use
[Rust + PyO3 wheels](/guide/shapes/rust-pyo3) instead — `maturin`
handles that shape natively. This page is for the C/C++/Cython
case where `setuptools` (or `hatchling`) is your build backend
and cibuildwheel is your wheel-matrix orchestrator.

## What piot covers

| Responsibility                                                                | piot   | Your workflow |
|-------------------------------------------------------------------------------|--------|---------------|
| Decide when to ship                                                            | ✅     |               |
| Compute the next version                                                       | ✅     |               |
| Rewrite `[project].version` in `pyproject.toml`                                | ✅     |               |
| OIDC trusted publishing to PyPI                                                | ✅     |               |
| `twine upload dist/*` — uploads every wheel + sdist cibuildwheel produced      | ✅     |               |
| Skip-if-already-published idempotency                                          | ✅     |               |
| Cut a git tag + GitHub Release                                                 | ✅     |               |
| Run `cibuildwheel` to produce the wheel matrix                                 |        | ✅            |
| Run `uv build --sdist` (or `python -m build --sdist`) for the source distribution |     | ✅            |
| Install Python, cibuildwheel, twine on the publish runner                      |        | ✅ ([runner prereqs](/guide/runner-prerequisites)) |
| Register the trusted-publisher policy on PyPI (one-time)                       |        | ✅            |

piot's PyPI handler shells out to `twine upload dist/*`. cibuildwheel
puts every produced wheel in a `wheelhouse/` directory; copy them
all into `dist/` before the piot publish step and twine ships
whatever it finds. **piot doesn't know or care that there are 30
wheels instead of 1** — it's just `twine upload` glob.

## Where the matrix lives

Unlike `build = "maturin"` (where piot owns the per-target build
matrix), with cibuildwheel **the matrix lives inside cibuildwheel
itself**. piot allocates one build row per package; cibuildwheel
fans out to every Python × platform combination internally and
returns a directory of wheels.

This means:

- Your `putitoutthere.toml` declares `build = "setuptools"` (or
  `"hatch"`) — not `maturin`. Without `maturin`, piot doesn't
  emit `targets`, and the plan matrix is just one build row per
  package.
- Your build job runs `cibuildwheel` once. cibuildwheel reads its
  own configuration from `pyproject.toml` (`[tool.cibuildwheel]`)
  to decide which Python versions and architectures to build.
- One job runs many compiles. Use `cibuildwheel`'s built-in
  cross-compile + emulation support, or a matrix at the GitHub
  Actions level (one job per `runs-on`) and let cibuildwheel
  build all Python versions per OS.

The two-level matrix (GitHub Actions for OS, cibuildwheel for
Python) is the conventional shape; the example below shows it.

## Configuration shape

A single `[[package]]` entry. `build = "setuptools"` (the
default) or `build = "hatch"` — both work; cibuildwheel respects
either build backend declared in `pyproject.toml`. **Do not** set
`targets` — that field is reserved for `build = "maturin"` and
piot's schema rejects it on `setuptools` / `hatch` packages.

```toml
[putitoutthere]
version = 1

[[package]]
name       = "my-lib"
kind       = "pypi"
build      = "setuptools"                 # or "hatch"
path       = "."
paths      = ["src/**", "pyproject.toml", "setup.py"]
tag_format = "v{version}"                 # single-package shape
```

cibuildwheel's own config lives in `pyproject.toml`:

```toml
# pyproject.toml
[tool.cibuildwheel]
build = "cp310-* cp311-* cp312-* cp313-*"
skip  = "*-musllinux_i686 pp*"
test-command = "pytest {project}/tests"
```

## Workflow shape

The conventional shape uses GitHub Actions matrix to fan out by
OS, with cibuildwheel handling the Python-version dimension
inside each row. The matrix is declared in your workflow — piot's
plan emits one build row per package and your workflow expands it
across the OS dimension:

```yaml
build:
  needs: plan
  if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
  strategy:
    fail-fast: false
    matrix:
      include: ${{ fromJSON(needs.plan.outputs.matrix) }}
      os: [ubuntu-latest, ubuntu-24.04-arm, macos-latest, windows-latest]
  runs-on: ${{ matrix.os }}
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - uses: actions/setup-python@v5
      with: { python-version: '3.12' }
    - name: Build wheels
      uses: pypa/cibuildwheel@v2
      with:
        package-dir: ${{ matrix.path }}
    - uses: actions/upload-artifact@v4
      with:
        name: wheels-${{ matrix.os }}
        path: wheelhouse/*.whl

  sdist:
    needs: plan
    if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null
    strategy:
      matrix:
        include: ${{ fromJSON(needs.plan.outputs.matrix) }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: astral-sh/setup-uv@v3
      - name: Build sdist
        working-directory: ${{ matrix.path }}
        run: uv build --sdist
      - uses: actions/upload-artifact@v4
        with:
          name: sdist
          path: dist/*.tar.gz

  publish:
    needs: [plan, build, sdist]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - name: Install twine
        run: pip install twine
      - name: Configure git identity
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
      - uses: actions/download-artifact@v4
        with: { path: dist, merge-multiple: true }
      - uses: thekevinscott/putitoutthere@v0
        with:
          command: publish
```

`merge-multiple: true` flattens every artifact (wheels from each
OS, plus the sdist) into one `dist/` directory. piot's PyPI
handler then runs `twine upload dist/*` and ships everything in
one go.

## Publish job prerequisites

Same as the plain Python library shape:

- **Python on PATH** (`actions/setup-python@v5`).
- **`twine` installed** (`pip install twine`).
- **A git committer identity.** piot cuts an annotated tag.

See [runner prerequisites](/guide/runner-prerequisites).

## One-time prerequisites before your first release

1. Register a [trusted publisher](/guide/auth) on PyPI for your
   project — exactly the same setup as the plain
   [Python library shape](/guide/shapes/python-library). Only the
   build half differs; the publish half is identical.
2. Declare `[package.trust_policy]` so `doctor` catches a rename
   mismatch.
3. Delete any long-lived `PYPI_API_TOKEN` repo secret once OIDC
   is working.

## Gotchas specific to this shape

- **`targets` is rejected on non-maturin builds.** piot's schema
  (`§12.2`) limits `targets` to `build = "maturin"`. If you try
  to declare `targets = [...]` with `build = "setuptools"` to
  carry per-OS metadata, the config fails validation. Keep the
  matrix in your workflow + cibuildwheel config; don't try to
  put it in `putitoutthere.toml`.
- **piot's version rewrite vs. cibuildwheel.** piot rewrites
  `[project].version` in `pyproject.toml` *before* the build job
  runs. cibuildwheel sees the rewritten version and stamps every
  wheel correctly. For the `[project].dynamic = ["version"]`
  case (hatch-vcs, setuptools-scm), piot does not rewrite — see
  [dynamic versions](/guide/dynamic-versions) for the env-var
  handoff. Most cibuildwheel projects use static versions; if
  yours is dynamic, the same caveat applies as the plain Python
  shape.
- **Wheel uploads are atomic per file, not per release.** If
  twine uploads 30 wheels and the 31st fails (e.g. PyPI rate
  limit, network blip), the first 30 are already on PyPI. PyPI
  doesn't allow re-uploading a file with the same name, so the
  bad-state recovery is to bump the version and republish *all*
  wheels. Yank the partial release via the PyPI Release-history
  page if you don't want consumers installing it. piot doesn't
  paper over this — twine's behavior is twine's behavior.
- **cibuildwheel image pulls dominate the runtime.** Each
  Linux wheel build pulls a `manylinux` Docker image (multiple
  GB). Use cibuildwheel's `CIBW_CONTAINER_ENGINE` and image
  caching options to cut wall-clock time. piot doesn't influence
  this — it's a build-side concern.
- **Cross-compiled aarch64-linux.** `ubuntu-latest` cannot
  reliably cross-link C extensions for `aarch64`. Use the
  native-arm runner `ubuntu-24.04-arm` (shown in the matrix
  above) rather than relying on cibuildwheel's qemu emulation
  path; emulation works but is slow.

## Further reading

- [Single-package Python library](/guide/shapes/python-library) —
  for pure-Python packages (no C extension). Same publish flow,
  simpler build.
- [Rust + PyO3 wheels](/guide/shapes/rust-pyo3) — if your
  extension is in Rust, use this shape instead.
- [Custom build workflows](/guide/custom-build-workflows) —
  per-package `build_workflow` delegation, useful if your
  cibuildwheel invocation is shared across multiple Python
  packages in the same repo.
- [Dynamic versions](/guide/dynamic-versions).
- [Runner prerequisites](/guide/runner-prerequisites).
- [Configuration reference](/guide/configuration).

# pypi maturin: optional `manylinux` platform-tag baseline

**Summary.** `kind = "pypi"` / `build = "maturin"` packages gain an
optional `manylinux` key (issue #610). Without it, linux wheels build
directly on the runner and inherit *its* glibc in their platform tag —
`manylinux_2_39` on today's `ubuntu-24.04` runners — so `pip` on any
older-glibc host rejects the wheel and silently builds from the sdist
(the failure shape reported in thekevinscott/dirsql#818). Setting e.g.
`manylinux = "2_28"` makes the planner stamp the value on each linux
wheel row of the matching libc family (`manylinux*` values → `-gnu`
triples, `musllinux_X_Y` values → `-musl` triples), and the build
workflows forward it to `PyO3/maturin-action`'s `manylinux` input: the
wheel builds inside the matching `quay.io/pypa` manylinux container and
maturin's auditwheel check fails the build if the result does not
comply. `verify wheel` gains a matching optional `--manylinux` flag that
asserts the produced wheel filename carries the requested tag.

**Required changes.** None. Purely additive — packages without the key
build exactly as before (on the host runner, host-glibc tag). To adopt:

| Before | After |
| --- | --- |
| ```toml
[[package]]
kind  = "pypi"
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]
``` | ```toml
[[package]]
kind  = "pypi"
build = "maturin"
manylinux = "2_28"
targets = ["x86_64-unknown-linux-gnu"]
``` |

Accepted values: `auto` (container default), legacy aliases `1` /
`2010` / `2014`, PEP 600 glibc baselines like `2_28`, or
`musllinux_X_Y`. The key is rejected on non-maturin pypi packages. If
the package also declares `bundle_cli`, note the staged binary is still
compiled on the host runner, so its glibc floor is the runner's — pair
the two only when that is compatible with the tag you request.

**Deprecations removed.** None.

**Behavior changes without code changes.** None — the key is new and
opt-in.

**Verification.** Add `manylinux = "2_28"` to a maturin package, cut a
release, and check the published wheel filenames: they end
`manylinux_2_28_x86_64.whl` / `manylinux_2_28_aarch64.whl` instead of
carrying the runner's glibc. `pip download <pkg> --no-deps` on a
glibc ≥ 2.28 host selects the wheel, not the sdist. The e2e fixture
`python-rust-maturin` exercises exactly this via
`verify wheel --manylinux 2_28`.

---

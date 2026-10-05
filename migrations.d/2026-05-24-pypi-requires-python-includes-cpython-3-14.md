# pypi `requires-python` includes CPython 3.14

**Summary.** Open-ended `requires-python` inference now expands against
putitoutthere's checked-in released-CPython list through CPython 3.14.
This fixes the stale-tail failure mode where `requires-python = ">=3.11"`
emitted cp311/cp312/cp313 wheels but omitted cp314 after Python 3.14 was
released.

**Required changes.** None.

| Before | After |
|--------|-------|
| `requires-python = ">=3.11"` planned wheels only through cp313. | `requires-python = ">=3.11"` plans cp311, cp312, cp313, and cp314, unless `python_versions` is explicitly set. |

**Deprecations removed.** None.

**Behavior changes without code changes.** Consumers with open-ended
`requires-python` ranges may see an extra cp314 wheel row. Explicit
`python_versions` overrides are unchanged and still pin the exact wheel
set.

**Verification.** Push a release for a `kind = "pypi"` package whose
`pyproject.toml` declares `requires-python = ">=3.11"`; the build matrix
should include a `python_version: "3.14"` row, and the published PyPI
release should include a cp314 wheel.

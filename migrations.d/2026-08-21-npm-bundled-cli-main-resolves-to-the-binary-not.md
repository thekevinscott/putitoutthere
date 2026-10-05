# npm bundled-cli: `main` resolves to the binary, not its directory

**Summary.** A `kind = "npm"` / `build = "bundled-cli"` platform package
whose artifact stages the cross-compiled binary **nested** —
`artifacts/<pkg>-<triple>/bin/<bin>` rather than flat — published a
broken tarball. The engine chose the synthesized package's `main` by
taking the first non-`package.json` entry `readdir` returned without
checking it was a file, so on the nested layout `main` named the `bin`
*directory*, and the #365 executable-bit restore (which chmods exactly
what `main` names) landed on that directory instead of the binary. The
tarball therefore shipped the binary at 0644 — the very condition #365
exists to prevent — and declared a `main` that resolves to nothing.
Both layouts reach this path because the artifact completeness check
lists files recursively, so neither was rejected upstream. `main` now
resolves through directories to the first actual file (`bin/<bin>`,
posix-separated on every platform), and the chmod follows it. Issue
#626.

**Required changes.** None. Purely a fix: flat artifacts synthesize
byte-identically to before, and consumers who stage nested get a correct
package instead of a broken one without touching their config or
workflow.

**Deprecations removed.** None.

**Behavior changes without code changes.** For nested bundled-cli
artifacts only:

| Before | After |
| --- | --- |
| platform `package.json` carried `"main": "bin"` (a directory) | `"main": "bin/<bin>"` (the binary) |
| published binary mode `0644` | published binary mode `0755` |

`build = "napi"` is unaffected — it locates its `.node` payload by
extension. Flat bundled-cli artifacts are unaffected: the first
non-`package.json` entry was already a file, and it still wins.

**Verification.** Re-release the package and inspect the per-triple
tarball:

```bash
npm view <pkg>-<triple>@<version> main          # => bin/<bin>, not bin
npm pack <pkg>-<triple>@<version> >/dev/null    # or download the tarball
tar -tvzf <pkg>-<triple>-<version>.tgz | grep '<bin>$'
#   -rwxr-xr-x  ... package/bin/<bin>          # +x present
```

Consumers who exec the binary directly (rather than through the
generated launcher, which re-chmods at spawn time) stop seeing `EACCES`.

---

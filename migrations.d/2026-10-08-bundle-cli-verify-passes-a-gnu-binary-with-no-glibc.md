### bundle_cli verify passes a gnu binary with no GLIBC_ symbols (#749)

**Summary.** The `bundle_cli` build and verify steps in `_matrix.yml` moved from
inline bash into the `bundle-cli-build` and `bundle-cli-verify` engine commands.
The old bash read the highest `GLIBC_` version from `objdump -T` under
`pipefail`, so a dynamically linked gnu binary with no versioned `GLIBC_`
symbol failed the step. It now passes.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** A dynamically linked
`-linux-gnu` bundled CLI binary that requires no versioned glibc symbol now
passes verification instead of failing the build job. Static binaries and
binaries above `GLIBC_2.17` still fail.

**Verification.** The build job log shows
`ok bundle_cli: <path> is dynamically linked, glibc ceiling none within GLIBC_2.17`.

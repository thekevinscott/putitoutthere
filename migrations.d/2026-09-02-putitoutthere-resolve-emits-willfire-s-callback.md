# `putitoutthere resolve` emits willfire's callback map

**Summary.** New additive subcommand (#683). `resolve` prints the callback
map [willfire](https://github.com/thekevinscott/willfire) consumes to
predict this repo's e2e plan job outputs ahead of dispatch (epic
thekevinscott/willfire#152): one JSON object on stdout, keyed
`thekevinscott/putitoutthere/.github/workflows/e2e-fixture-job.yml:plan`,
one entry per fixture. It delegates every matrix to the `piot-ci
fixture-matrix` core, so the map cannot drift from what the live job
computes. Zero arguments, zero env inputs, no network.

**Required changes.** None. Consumers of the reusable workflow are
unaffected; `resolve` answers `{}` from any checkout that does not define
`.github/workflows/e2e-fixture-job.yml`. To wire willfire's gate for this
repo, pass the command as the callback (the command string is opaque to
willfire — `pnpm exec putitoutthere resolve` and `npx putitoutthere
resolve` are equally valid spellings).

**Deprecations removed.** None.

**Behavior changes without code changes.** None.

**Verification.**

```bash
pnpm exec putitoutthere resolve | head -c 80
# {"thekevinscott/putitoutthere/.github/workflows/e2e-fixture-job.yml:plan":[{"inp
```

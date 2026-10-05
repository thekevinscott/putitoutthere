# Preflight npm package name must match configured name

**Summary.** Preflight gains `requirePackageJsonShape`, the npm analogue
of `requirePyprojectShape` / `requireCargoShape` (#301). Every cascaded
`kind = "npm"` package's `package.json` `name` must equal the configured
`[[package]].name` (or the `npm` override). `npm publish` packs the
manifest `name`, but the engine's idempotency probe (`npm view <name>`)
and the tag / release-URL bookkeeping use the configured name — so a
divergence silently breaks idempotency and can publish under an
unexpected name. pypi and crates already enforced the equivalent
(`PIOT_PYPI_NAME_MISMATCH`, `PIOT_CRATES_NAME_MISMATCH`); this closes the
gap for npm. The check fires at publish time alongside the existing
`require*` family and at PR time via `check.yml`. Findings aggregate
across every failing package.

**Required changes.** None for well-formed manifests — `package.json`
`name` already matches the configured name in the common case. The repos
that trip the new check are those that used a path-style identifier as
`[[package]].name` (e.g. `js/foo`) without setting the `npm` override
while shipping `package.json` `name = "foo"`; those previously published
with a broken `npm view` idempotency check and a wrong reported URL, and
now get a fast preflight red instead. Fix by aligning the names or
declaring the override:

| Before | After |
|--------|-------|
| `name = "js/foo"` (no `npm` override), `package.json` `name = "foo"` | add `npm = "foo"` to the `[[package]]` entry (or rename one side so the two agree) |

The new error code:

| Code | Fires when |
|------|------------|
| `PIOT_NPM_NAME_MISMATCH` | `package.json`'s `name` differs from `[[package]].name` (or the `npm` override). |

**Deprecations removed.** None.

**Behavior changes without code changes.** An npm package with a name
divergence that previously published (under the manifest name, with a
broken `npm view` idempotency check and a wrong reported URL) now fails
at preflight with a fingerprintable `PIOT_NPM_NAME_MISMATCH` before any
side effect. Scoped names are compared verbatim (`npm = "@scope/foo"`
matches `package.json` `name = "@scope/foo"`). A missing or malformed
`package.json` is left to the other checks / the publish step.

**Verification.** Set an npm package's `package.json` `name` to something
other than its configured `[[package]].name` (with no `npm` override),
run `pnpm putitoutthere check` (or open a PR with `check.yml` wired), and
see `PIOT_NPM_NAME_MISMATCH` surface in seconds instead of mid-release.

# Platform-publish `.npmrc` lookup

**Summary.** The reusable workflow's per-triple platform-package
publishes (`build = "bundled-cli"` / `build = "napi"`) ran `npm
publish` from a temporary staging directory rather than from the
consumer's package path. npm reads `.npmrc` from cwd upward; the
consumer's `.npmrc` lives at `pkg.path`, never on the path to a
tempdir, so platform publishes never saw the auth the main package
relied on. OIDC trusted publishing masked the gap (auth flows via
the `ACTIONS_ID_TOKEN_REQUEST_TOKEN` environment variable, not
`.npmrc`), but the `NPM_TOKEN` bootstrap path (#310) — required
for the very first publish of a brand-new npm package — and the
internal Verdaccio e2e seam (#304) both broke because both rely on
`.npmrc`-supplied auth.

The engine now invokes `npm publish <stagingDir>` with `cwd:
pkg.path`, matching how the main-package publish already runs.
npm reads the consumer's `.npmrc` (including any `_authToken`,
`always-auth`, or scoped-registry entries) and applies it to the
PUT for each per-triple platform package.

**Required changes.** None. The fix is internal to
`src/handlers/npm-platform.ts`; consumer `release.yml` flows are
unchanged.

**Deprecations removed.** None.

**Behavior changes without code changes.** Consumers who rely on
`NPM_TOKEN` (rather than OIDC) for the first publish of a
bundled-cli / napi family — i.e. a brand-new npm package whose
per-triple sub-packages also don't exist yet — now succeed without
the workaround of publishing a `0.0.0-bootstrap` stub by hand.
OIDC consumers see no observable difference: the same env-derived
auth keeps flowing because `npm publish` reads
`NODE_AUTH_TOKEN`/`ACTIONS_ID_TOKEN_REQUEST_TOKEN` from the
environment regardless of which directory cwd points at.

**Verification.** A consumer publishing a brand-new bundled-cli /
napi family via `NPM_TOKEN` completes per-triple sub-package
publishes alongside the main package on the first release run,
with no `npm publish (platform) failed` errors in the log.

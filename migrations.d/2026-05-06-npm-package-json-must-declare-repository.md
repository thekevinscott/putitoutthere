# npm package.json must declare `repository`

**Summary.** Every cascaded `kind = "npm"` package's `package.json`
must now carry a non-empty `repository` field. The new preflight
check (`requireProvenanceMetadata` in `src/preflight.ts`) runs in
`src/publish.ts` immediately after `requireAuth` and rejects the
run with `PIOT_NPM_MISSING_REPOSITORY` before any runner work.
Why: `putitoutthere` invokes `npm publish --provenance` on the OIDC
trusted-publisher path; the npm CLI hard-requires this field so the
registry can verify the artifact was built from the repo the trusted
publisher declares. A missing or empty field previously surfaced
only after the runner had spun up, OIDC had been negotiated, and
the artifact had been built — wasting a full release run on a
precondition checkable in milliseconds. Hit in the wild on
`coaxer@0.1.1`'s first npm release; tracked in #280.

The npm handler's inline backstop (`assertRepositoryField` in
`src/handlers/npm.ts`) is also tightened. Previously it used
`if (!pkg.repository)` — falsy-only — which let three real shapes
slip through: an object without `url` (`{ type: 'git' }`), an
empty object (`{}`), and a whitespace-only string (`'   '`). All
three are now rejected; the error message also carries the stable
`PIOT_NPM_MISSING_REPOSITORY` code and the path of the offending
file, matching the preflight error.

**Required changes.** Add a `repository` block to every
`package.json` declared as `kind = "npm"` in
`putitoutthere.toml`. Canonical shape:

| Before                                              | After                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "name": "@scope/lib", "version": "0.1.0" }`      | `{ "name": "@scope/lib", "version": "0.1.0", "repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git", "directory": "<path/to/package>" } }` |

`directory` is needed for monorepo packages so npm can locate the
source within the repo. Both the object form and the legacy single-
string form (`"repository": "git+https://github.com/<owner>/<repo>.git"`)
are accepted; only a missing field, an empty string, or an object
without a non-empty `url` fails the check.

No `release.yml` or `putitoutthere.toml` changes are required.

**Deprecations removed.** None.

**Behavior changes without code changes.** `putitoutthere publish`
now fails fast at preflight with
`[PIOT_NPM_MISSING_REPOSITORY] npm publish requires a non-empty
\`repository\` field in package.json` for any cascaded npm package
whose `package.json` lacks the field. Previously the same shape
ran through plan + build + auth-negotiation + artifact-staging
and failed inside `npm publish` with `npm publish --provenance
requires a \`repository\` field in package.json`. Well-formed
packages are unaffected.

The error message names every failing package and its
`package.json` path so consumers fix all of them in one round-trip
rather than discovering them one at a time across multiple release
attempts.

**Verification.** Drop the `repository` field from one of your
`package.json` files locally and run `pnpm test:integration` (or
the engine against a local fixture); the failure should arrive at
preflight with `PIOT_NPM_MISSING_REPOSITORY` in the message, no
platform packages should be published, and no git tag should be
created. Restore the field; the next run completes normally.

---

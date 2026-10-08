### npm tarball verification reads the per-version document (#716)

**Summary.** `verify npm-tarball` found the published tarball through `npm view`, which reads npm's packument. npm caches that for five minutes, so the step could fail a publish that succeeded. It now reads `GET /<name>/<version>`, which is uncached, and retries for up to about 12 minutes against public npm.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** The step no longer runs `npm view`. On public npm the retry budget grows from 320s to 710s. Log lines changed: retries print `<url> not readable yet (attempt N/M); retrying in Ns`, and the failure reads `<registry> never returned a tarball URL after N attempts`.

**Verification.** After an npm publish, the step prints `ok: package/<dir>/ (N file(s))`.

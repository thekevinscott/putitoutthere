### npm main package waits for its platform packages (#733)

**Summary.** For `build = "napi"` and `build = "bundled-cli"`, `publish` published the platform packages and then the main package straight away. npm could make the main package installable before a platform package was visible, and installs in that window silently lacked the native addon. `publish` now waits until every platform package it just published resolves at `GET /<name>/<version>` before it publishes the main package.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** A publish job can spend up to about 12 minutes between the platform publishes and the main publish; usually it is seconds. Retries print `<url> not readable yet (attempt N/M); retrying in Ns` to stderr. If a platform package never resolves, the job fails with `npm: <name>@<version> was published but its per-version document never resolved; not publishing the main package, which would install without it`, and the main package stays unpublished. A re-run skips the platform packages already published and publishes the main package once they resolve.

**Verification.** The publish log shows the platform packages line, then the main package publish. `npm view <main>@<version> optionalDependencies` lists platform packages that each install.

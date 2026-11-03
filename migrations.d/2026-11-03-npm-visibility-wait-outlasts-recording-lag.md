# npm visibility wait outlasts the recording lag (#785)

**Summary.** Before publishing a main npm package, the release waits for each platform package's per-version document on registry.npmjs.org. `verify npm-tarball` waits for the same document. Both gave up after about 12 minutes of retries, and npm has taken up to 16 minutes to record a version. They now poll until a 20-minute deadline. In a publish, that one deadline covers every platform package, not each one.

**Required changes.** None.

**Deprecations removed.** None.

**Behavior changes without code changes.** A publish or `verify npm-tarball` run can wait up to 20 minutes, only while npm has not recorded the version. Retries back off 5s, 15s, 30s, then every 60s. Retry lines read `<url> not readable yet (attempt N); retrying in Ns`, without the old `/total`. A version that never appears fails with the same publish error as before, and `verify npm-tarball` now says `never returned a tarball URL within 20 minutes`. Runs against an override registry keep their short schedule.

**Verification.** A release whose platform package npm records slowly now publishes the main package after some retry lines, instead of failing with `per-version document never resolved`.

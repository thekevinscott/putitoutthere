# npm first-publish surfaces the bootstrap hint on E404

**Summary.** npm answers an unauthorized publish with `E404 Not Found`,
not `E401`/`E403` — confirming that a package exists but is not writable
by you is itself an information disclosure, so the registry declines to
distinguish "missing" from "not yours". The engine's
`looksLikeAuthFailure` matched every other auth shape but not that one.

The casualty was the bootstrap-paradox hint. npm trusted publishing
binds to an already-published package, so a consumer's very first
publish has no OIDC path and must go through a token once. When that
first publish runs under OIDC, the token exchange fails, setup-node's
placeholder `_authToken` survives in `.npmrc`, and the PUT comes back
404. Both conditions the hint was written for held — OIDC in play, the
package genuinely absent — but the guard short-circuited on the
unmatched code, so the operator saw a raw npm stderr dump instead of the
one sentence telling them to set `NODE_AUTH_TOKEN` for the bootstrap
publish and migrate afterwards.

**Required changes.** None. No config key, workflow input, or trailer
grammar changes.

**Deprecations removed.** None.

**Behavior changes without code changes.** A failing first npm publish
now fails with:

```
npm publish: package "<name>" does not exist on registry.npmjs.org yet.
npm trusted publishing requires the package to exist first.
Bootstrap by setting NODE_AUTH_TOKEN for the first publish; you can
migrate to trusted publishing afterwards.
```

instead of npm's raw `E404` block. The exit code is unchanged — this
was never a passing release, only an unexplained failure.

Deliberately unchanged: an `E404` on a package that **is** on the
registry still surfaces the raw npm stderr. That shape is a transient
OIDC token-exchange failure rather than a bootstrap case (npm's
`lib/utils/oidc.js` swallows every exchange failure, leaving the
placeholder token in place), and it is what putitoutthere's own `0.2.80`
release run hit. Claiming "the package does not exist" there would push
an operator to abandon trusted publishing over a blip. The two causes
produce byte-identical stderr, so the engine tells them apart with the
packument probe, not the error text.

**Verification.** On a repo whose npm package has never been published,
run a release with OIDC and no `NODE_AUTH_TOKEN`. The publish step fails
with the three-line bootstrap message above, naming your package. Set
`NODE_AUTH_TOKEN` to a publish-scoped token, re-run, and the first
publish lands; trusted publishing works unaided from the second release
onward.

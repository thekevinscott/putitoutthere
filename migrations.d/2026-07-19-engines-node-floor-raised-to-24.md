# `engines.node` floor raised to 24

**Summary.** The published `putitoutthere` package declared
`engines.node` of `>=20` while every CI leg ran Node 24. Nothing in the
test matrix exercised Node 20, so the declared floor was an unverified
claim rather than a supported configuration. It is now `>=24`, matching
what is actually tested.

**Required changes.** Upgrade to Node 24 or later if you are below it.

| | Before | After |
|---|---|---|
| `engines.node` | `>=20` | `>=24` |
| `engines.pnpm` | (unset) | `>=11` |

**Deprecations removed.** Support for Node 20 through 23, which was
declared but never tested.

**Behavior changes without code changes.** Installing under Node 20–23
emits an `EBADENGINE` warning under npm and fails with
`ERR_PNPM_UNSUPPORTED_ENGINE` under pnpm. Node 20 is past end-of-life,
so this affects runtimes that are already unsupported upstream.

**Verification.** `node --version` reports v24 or later, and
`npm install putitoutthere` completes with no `EBADENGINE` warning.

---

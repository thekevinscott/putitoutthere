# npm: an unreachable registry reads as UNKNOWN, not PUBLISH

**Summary.** `plan` asks each registry whether the planned version is
already live, and for npm it asks by shelling out to
`npm view <name>@<version> version` and reading the exit status. Every
non-zero exit was read as one thing — "that version is not published" —
which is right for the answer the probe was written for (`E404`) and
wrong for every way the question can fail to be asked at all. A run whose
network could not reach `registry.npmjs.org` reported
`verdict: publish` for a package it had never got an answer about, and
`plan` presented that as fact.

The same code path was also slow, for the same reason. Because piot
passed no retry configuration, the probe inherited npm's own defaults —
`fetch-retries=2`, `fetch-retry-mintimeout=10s`,
`fetch-retry-maxtimeout=60s` — and npm applies them without
distinguishing a 503 from a hostname that does not resolve. A DNS failure
is deterministic within a run: no retry turns a name that does not
resolve into one that does. piot paid ~70s per npm package to re-ask a
question that had already been answered as fully as it ever would be.
Measured against a `--network none` sandbox, `plan` took **70.3s** to
emit a matrix it produces byte-identically in under a second with
network.

`npm view` now runs with `--fetch-retries=0` and piot classifies the
failure itself, off npm's machine-readable `npm error code <CODE>` line:

| npm code | reading | effect on the verdict |
| --- | --- | --- |
| `E404` (and anything unrecognised) | the registry answered; the version is not there | `publish` — unchanged |
| `ENOTFOUND`, `EAI_AGAIN` | there is no registry to talk to | `unknown`, on the first attempt |
| `ETIMEDOUT`, `ECONNRESET`, `ERR_SOCKET_TIMEOUT`, `E429`, `E5xx` | the registry was reached and faltered | raised as a `TransientError`, retried by the publish path's existing retry policy |

**Required changes.** None. No config key, workflow input, or trailer
changes, and a run with working network to npm produces the same matrix
and the same verdicts it did before.

**Deprecations removed.** None.

**Behavior changes without code changes.** Three, all in how an npm
verdict is reached rather than in what a healthy run reports.

- A network failure that prevents piot from reaching npm renders that
  package's `plan` verdict as `unknown` instead of `publish`. `unknown`
  is what crates.io and PyPI already report in the same situation, so npm
  is joining the existing posture rather than inventing one. It is
  deliberately not a hard failure: `plan` still emits its full matrix, and
  `unpublished_kinds` counts `unknown` as unpublished, so a run whose npm
  verdict could not be resolved still acquires npm auth and still attempts
  the publish — which then fails with "the registry could not be reached"
  as its message rather than discovering it inside `npm publish`.
- Transient npm failures during the probe — timeouts, reset connections,
  429, 5xx — are now retried by piot's retry policy. Previously they were
  swallowed into "not published" before the policy could see them, so this
  restores coverage rather than removing it.
- An offline or DNS-blocked `plan` returns in roughly the time the rest of
  the plan takes instead of ~70s per npm package. The saved time is
  entirely npm's retry ladder against a name that will not resolve.

**Verification.** Run `plan` with npm pointed at a hostname that does not
resolve:

```bash
npm_config_registry=https://<a-host-that-does-not-resolve>.invalid/ \
  putitoutthere plan --config putitoutthere.toml
```

Before: the command takes ~70s per npm package and each one reports
`"verdict":"publish"`. After: it returns in well under a second and the
npm rows report `"verdict":"unknown"`, with the matrix otherwise
identical. A normal run against the real registry is unchanged — same
verdicts, same matrix.

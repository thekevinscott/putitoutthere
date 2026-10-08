# crates.io auth runs only when a crates version is unpublished

**Summary.** The reusable workflow's `Authenticate with crates.io (OIDC)`
step gated on the build matrix carrying a crates row:

```yaml
if: contains(needs.build.outputs.matrix, '"kind":"crates"') && env.CALLER_CARGO_REGISTRY_TOKEN == ''
```

That asks *"does this repo have a crates package?"* — true whenever a
crate is declared, published or not. So the OIDC exchange ran even when
every crates row in the plan was already on the registry and the handler
would skip it via `isPublished`. When the exchange failed — no trusted
publisher registered yet, or a record that hadn't propagated — it failed
the whole `publish` job before the engine action ran, taking npm and PyPI
down with it for crates.io work that was never going to happen.

That is exactly the re-run-after-partial-failure state `isPublished`
exists to make safe. A repo whose crate is current could not re-run to
fix an unrelated registry unless its crates.io trusted publishing was
fully configured, and the token → OIDC handover became order-sensitive in
a way nothing documented: unset `CARGO_REGISTRY_TOKEN` a moment before the
crates.io config propagates and the next run failed on a registry it had
no business contacting.

`plan` now emits an `unpublished_kinds` step output — the registry kinds
carrying at least one package whose planned version is **not** already
live, computed from the same `handler.isPublished` the publish path
dispatches through, so the gate and the handler can never disagree.
`_matrix.yml` re-exposes it as a `workflow_call` output and the OIDC step
gates on that:

```yaml
if: contains(needs.build.outputs.unpublished_kinds, '"crates"') && env.CALLER_CARGO_REGISTRY_TOKEN == ''
```

A kind whose registry could not be reached stays listed. Reading "we could
not tell" as "nothing to do" would drop a credential the publish may still
need, turning a registry blip at plan time into an auth failure at publish
time; listing it preserves the previous behaviour in exactly that case.

The caller-provided-token export steps (`CARGO_REGISTRY_TOKEN`,
`NODE_AUTH_TOKEN`) deliberately keep the wider matrix gate: they only write
an env var, so running them with nothing to publish costs nothing and
cannot fail the job. The narrowing exists because a *failing exchange* took
the run down, and there is no exchange in those steps to fail.

**Required changes.** None. This is a fix inside the reusable workflow.

| | Before | After |
| --- | --- | --- |
| Your `release.yml` | unchanged | unchanged |
| `putitoutthere.toml` | unchanged | unchanged |
| `secrets:` you pass | unchanged | unchanged |

**Deprecations removed.** None.

**Behavior changes without code changes.**

- A release run whose crates.io versions are all already published no
  longer runs `rust-lang/crates-io-auth-action`, and therefore no longer
  requires a working crates.io trusted publisher. npm and PyPI work in the
  same run proceeds.
- A run with genuine crates.io work is unchanged: the exchange runs, and a
  missing trusted publisher still fails the run — correctly, because there
  is something to publish.
- A run where crates.io could not be reached at plan time is also
  unchanged: the kind stays listed and the exchange runs.
- Callers passing `CARGO_REGISTRY_TOKEN` are unaffected either way — that
  path never ran the exchange.
- `_matrix.yml` gains an `unpublished_kinds` `workflow_call` output.
  `release.yml`'s own outputs are unchanged; nothing a consumer reads was
  added or removed.

**Verification.** Re-run a release on a ref whose crates.io version is
already live. In the run log, `Authenticate with crates.io (OIDC)` now
shows as **skipped**, and the publish job proceeds to the engine action.
Locally, the same answer is one command:

```bash
GITHUB_OUTPUT=/tmp/out putitoutthere plan
grep unpublished_kinds /tmp/out
# unpublished_kinds=[]        <- nothing left to publish; no auth needed
# unpublished_kinds=["npm"]   <- only npm has work; crates.io is not contacted
```

# Registry response fixtures

Captured (and sanitised) responses from real registries that the engine
must react to correctly. One file per response shape; companion tests in
[`../../registry-auth.integration.test.ts`](../../registry-auth.integration.test.ts)
replay each fixture and assert the engine's reaction.

The catalog of "registry behaviours we depend on" lives at
[`notes/upstream-behaviors.md`](../../../../notes/upstream-behaviors.md);
add a row there when a new fixture lands.

## Layout

```
crates-io/
  publish-first-publish-tp-rejected.txt   cargo stderr when OIDC TP is used on
                                          a crate that has never been published
                                          (#284)
npm/
  publish-e403-over-publish.txt           npm CLI stderr from the "publish
                                          retry hit a registry that already
                                          has the version" race (#281)
  publish-422-missing-repository.txt      npm CLI stderr when --provenance is
                                          used with an empty/missing
                                          `repository` field (#281; today
                                          caught at preflight)
pypi/
  oidc-mint-tp-filter-rejected.json       PyPI's mint-token endpoint response
                                          when the OIDC token's `repository`
                                          claim doesn't match any registered
                                          TP — happens to every reusable-
                                          workflow caller per warehouse#11096
                                          (#252)
```

## Conventions

- **Text fixtures** (`.txt`) capture stderr verbatim. Trailing newline preserved.
- **JSON fixtures** (`.json`) capture HTTP response bodies. Pretty-printed for
  readability; the engine never parses these as-is (real responses arrive
  minified), so whitespace is not load-bearing.
- **Identifiers** (crate names, package names, owner slugs) are scrubbed to
  generic placeholders (`demo-crate`, `demo-pkg`, `acme/demo`). The shape
  matters, not the specific values.
- **Don't** add a new fixture without a matching test and catalog entry.

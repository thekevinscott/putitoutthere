# Design commitments

These are explicit non-goals for `putitoutthere`. They bound the tool's scope
and keep it from metastasising into a general-purpose release orchestrator.
Reject future proposals that would absorb any of the following, even when
users ask for them.

## Scope

`putitoutthere` is a polyglot registry publisher. OIDC-first, cascade-aware,
across crates.io + PyPI + npm. Everything else composes around it.

## Non-goals

1. **Version computation.** Delegate to release-please / release-plz.
   `putitoutthere` takes `{name, version}` as input; it does not analyse
   commits, compute bumps, or maintain changelogs.
2. **Tag creation and trigger orchestration.** The consumer's workflow owns
   triggers — schedule, push, dispatch, trailer detection. `putitoutthere`
   is invoked with a version and a plan; it does not wrap the workflow.
3. **GitHub Release binary archive production.** `cargo-dist` and
   `goreleaser` occupy that lane. Compose with them; don't absorb their
   cross-compile and archive-packaging responsibilities.
4. **Arbitrary pre-publish shell hooks.** Generic hooks metastasise into a
   plugin ecosystem within a year (see `semantic-release`). Consumers run
   custom build steps in their own workflow *before* invoking
   `putitoutthere`, not as a config-level hook.
5. **Monorepo discovery.** Packages are declared explicitly via
   `[[package]]` entries. No directory walking, no workspace auto-detection.
   The same config shape works for mono and multi repos.
6. **Changelog generation.** Already solved upstream by release-please and
   friends. `putitoutthere` does not read or write changelogs.

## The decision test

Before adding any new feature, ask:

> *"Would release-please, cargo-dist, or changesets also want this?"*

If yes, it belongs in a compositional layer, not in `putitoutthere`.

## Provenance

These commitments were written up in response to an external evaluation
(`thekevinscott/dirsql#159`) that surfaced pressure to expand scope in
several of the directions above. Keeping them explicit prevents that
pressure from silently eroding the tool's focus over time.

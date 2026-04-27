# Design commitments

These are explicit non-goals for `putitoutthere`. They bound the tool's scope
and keep it from metastasising into a general-purpose release orchestrator.
Reject future proposals that would absorb any of the following, even when
users ask for them.

## Scope

`putitoutthere` is a reusable GitHub Actions workflow that publishes packages
to crates.io, PyPI, and npm — OIDC-first, cascade-aware, polyglot. The
user-facing surface is one line in a consumer's `release.yml`:

```yaml
uses: thekevinscott/putitoutthere/.github/workflows/release.yml@v0
```

…plus a config file declaring packages. Everything else composes around it.

## Non-goals

1. **Version computation.** Delegate to release-please / release-plz.
   `putitoutthere` takes `{name, version}` as input; it does not analyse
   commits, compute bumps, or maintain changelogs.

2. **Trigger orchestration.** The consumer's `release.yml` owns triggers
   (`on: push`, `on: schedule`, `on: workflow_dispatch`) and trailer
   detection. `putitoutthere`'s reusable workflow is invoked from inside
   that triggered workflow; it does not decide *when* releases fire.

3. **GitHub Release binary archive production.** `cargo-dist` and
   `goreleaser` occupy that lane. Compose with them; don't absorb their
   cross-compile and archive-packaging responsibilities.

4. **Build escape hatches.** No arbitrary `steps:`. No `build_workflow:`
   delegation. No pre-publish shell hooks. `putitoutthere` supports
   only the named build modes its handlers implement (e.g. `hatch`,
   `maturin`, `napi`, `bundled-cli`). Shapes that don't fit
   (`cibuildwheel`, custom `Makefile`s, exotic cross-compile rigs)
   write their own release workflow and don't use `putitoutthere`.
   Generic hooks metastasise into a plugin ecosystem within a year
   (see `semantic-release`); the rule exists to keep that pressure
   from silently eroding the tool's focus.

5. **Monorepo discovery.** Packages are declared explicitly via
   `[[package]]` entries. No directory walking, no workspace
   auto-detection. The same config shape works for mono and multi
   repos.

6. **Changelog generation.** Already solved upstream by release-please
   and friends. `putitoutthere` does not read or write changelogs.

7. **Public CLI surface.** A `putitoutthere` CLI exists in this
   repository — it is the call site the reusable workflow invokes
   internally, and the affordance for unit-testing the engine outside
   GitHub Actions. It is **not** a consumer-facing tool. Docs, README,
   and getting-started copy describe only the reusable workflow. CLI
   flag stability, help-text quality, and discoverability are explicit
   non-priorities.

8. **Diagnostic subcommands (`doctor`, `preflight`) as public
   surfaces.** Token-scope and auth checks fold into the reusable
   workflow's publish phase as internal pre-publish steps. There is
   no standalone PR gate, no separate workflow shape, and no GitHub
   Action input for these. The CLI subcommands persist for local
   debugging but are not surfaced in docs.

9. **Release backfill as a workflow shape.** Re-creating GitHub
   Releases for tags that pre-date `putitoutthere` is a one-off
   migration step. Consumers handle it manually; no
   `release-backfill.yml` example, no documented workflow shape.

10. **Step-level GitHub Action surface.** The repo ships a JS action
    (`action.yml`) that wraps the CLI as a single step. It exists so
    the reusable workflow can call the engine; it is **not** a
    consumer integration point. Consumers compose with the reusable
    workflow, not with individual CLI subcommands as steps.

## The decision test

Before adding any new feature, ask:

> *"Would release-please, cargo-dist, or changesets also want this?"*

If yes, it belongs in a compositional layer, not in `putitoutthere`.

A second test specifically for the surface area:

> *"Does this require the consumer to write more than ~10 lines of
> `release.yml`?"*

If yes, the design is wrong. Move the work into the reusable workflow.

## Provenance

The original commitments (1–6) were written up in response to an external
evaluation (`thekevinscott/dirsql#159`) that surfaced pressure to expand
scope. The April 2026 revision — Scope rewrite to "reusable workflow",
strengthened non-goal #4, and new non-goals 7–10 — followed a coaxer
integration session where a consumer's hand-written `release.yml`
silently broke after an action-version bump. Capturing the rule that
`putitoutthere` ships the workflow itself, and that the CLI and JS
action are internal, prevents the integration surface from drifting
back to "consumer maintains a 100-line release.yml against a
documented contract".

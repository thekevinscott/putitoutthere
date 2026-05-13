# Design commitments

putitoutthere is a reusable GitHub Actions workflow for releasing polyglot
packages to crates.io, PyPI, and npm. Using it should be easier than writing
release code from scratch.

This workflow must strive to be as straight forward and configuration free as
possible.

## Goals

### As little configuration as possible

Consumers of this workflow should need to write as little configuration as
possible. Where defaults can be set, they should.

### No release surprises

By the time we make it to a release there should be _no_ surprises. Releases
are a dangerous and fraught time, and the cost of a mistake at release is
catastrophic. This workflow should strive to surface issues _before_ we get
to a release. If an issue surfaces during release, this workflow has failed
at its job.

In practice that means catching what we can as early as we can. Anything we
can check against the consumer's repo alone, we check at PR time. Anything
we can check from the planned matrix, we check at plan time. Only checks
that depend on live registry state are allowed to wait until publish.

### Adapt to existing tools and workflows

This workflow should, as much as possible, go with the flow of existing
tools and workflows. We live inside GitHub Actions, so YAML and Actions
conventions are first class. We don't reinvent things that release-please,
release-plz, cargo-dist, or trusted publishers already solve. We compose
with them.

### Secure by default

OIDC trusted publishers are the recommended auth path on all three
registries, and the default whenever the registry will allow it. Long-lived
tokens stay supported because trusted publishing on crates.io and npm binds
to an already-published package, so the very first publish has no OIDC
path. Our job is to make the OIDC path effortless and the token path a
documented fallback, not to forbid the fallback.

### Cascade-aware by design

Packages can declare what they depend on. When a dependency releases, its
dependents release in the same run. Polyglot repos with a shared core (a
Rust crate wrapped by a Python wheel and an npm package, for example) are
the motivating case. Coordinating three single-package release tools by
hand is exactly the manual error this workflow exists to remove.

### All-or-nothing per package

A planned package either publishes completely, every artifact across every
target, or not at all. Half-shipped cascades are the worst failure mode in
releases, and there is no opt-out or flag for relaxing this.

## Non-goals

These are the things this workflow deliberately does not do. Reject future
proposals that would absorb any of them, even when users ask for them.

1. **Version computation.** Delegate to release-please and release-plz.
   putitoutthere takes `{name, version}` as input. It does not analyse
   commits, compute bumps, or maintain changelogs.

2. **Trigger orchestration.** The consumer's `release.yml` owns triggers
   (`on: push`, `on: schedule`, `on: workflow_dispatch`) and trailer
   detection. putitoutthere's reusable workflow is invoked from inside
   that triggered workflow; it does not decide _when_ releases fire.

3. **GitHub Release binary archive production.** cargo-dist and
   goreleaser occupy that lane. Compose with them. Don't absorb their
   cross-compile and archive-packaging responsibilities.

4. **Build escape hatches.** No arbitrary `steps:`. No `build_workflow:`
   delegation. No pre-publish shell hooks. putitoutthere supports only
   the named build modes its handlers implement (e.g. `hatch`,
   `maturin`, `napi`, `bundled-cli`). Shapes that don't fit
   (`cibuildwheel`, custom `Makefile`s, exotic cross-compile rigs)
   write their own release workflow and don't use putitoutthere.
   Generic hooks metastasise into a plugin ecosystem within a year
   (see `semantic-release`); the rule exists to keep that pressure
   from silently eroding the workflow's focus.

5. **Monorepo discovery.** Packages are declared explicitly via
   `[[package]]` entries. No directory walking, no workspace
   auto-detection. The same config shape works for mono and multi
   repos.

6. **Changelog generation.** Already solved upstream by release-please
   and friends. putitoutthere does not read or write changelogs.

7. **Public CLI surface.** A putitoutthere CLI exists in this
   repository. It is the call site the reusable workflow invokes
   internally, and the affordance for unit-testing the engine outside
   GitHub Actions. It is **not** a consumer-facing tool. Docs, README,
   and getting-started copy describe only the reusable workflow. CLI
   flag stability, help-text quality, and discoverability are explicit
   non-priorities.

8. **Parallel diagnostic surfaces.** "No release surprises" is met by
   exposing one reusable workflow per release-path phase, no more.
   Internal validations live in the engine, not in a parallel
   diagnostic surface (a `doctor` CLI subcommand promoted to public,
   a step-level action, per-check workflow inputs) that a consumer
   has to remember to wire up check-by-check.

9. **Release backfill as a workflow shape.** Re-creating GitHub
   Releases for tags that pre-date putitoutthere is a one-off
   migration step. Consumers handle it manually. No
   `release-backfill.yml` example, no documented workflow shape.

10. **Step-level GitHub Action surface.** The repo ships a JS action
    (`action.yml`) that wraps the CLI as a single step. It exists so
    the reusable workflow can call the engine. It is **not** a
    consumer integration point. Consumers compose with the reusable
    workflow, not with individual CLI subcommands as steps.

## The decision test

Before adding any new feature, ask:

> _"Would release-please, cargo-dist, or changesets also want this?"_

If yes, it belongs in a compositional layer, not in putitoutthere. This is
the "adapt to existing tools and workflows" goal in question form: if
another tool in the release stack already covers it, we compose, we don't
absorb.

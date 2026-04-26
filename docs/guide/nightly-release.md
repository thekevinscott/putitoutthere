# Nightly release

::: warning Page being rewritten
The example workflow on this page describes the prior hand-written-`release.yml` integration model. The reusable-workflow surface will reduce this to a few lines of triggers in the consumer's file. See [design commitments](https://github.com/thekevinscott/putitoutthere/blob/main/notes/design-commitments.md).
:::

Ship a patch every night whenever there are unreleased commits — without writing a `release:` trailer on every fix.

## How it works

putitoutthere doesn't own the cron; your `release.yml` does. The workflow fires on a schedule, runs the release pipeline, and publishes whatever the plan contains:

- If files changed inside a package's `paths` since the last tag, the package cascades and ships at `patch`.
- If nothing changed, the plan is empty and the workflow is a no-op.

No trailer is required. [Trailers](./trailer.md) remain available for explicit `minor`/`major` bumps or `skip` on the rare merge you don't want released — they just aren't load-bearing for nightly patching.

## Combining with trailer-driven bumps

Nightly cron and trailer-driven releases compose — they're the same pipeline, different triggers. Push a commit with `release: minor` and the next cron (or a manual `workflow_dispatch`) bumps minor across cascaded packages. Most commits won't carry a trailer, and those ship at `patch` on the next cron.

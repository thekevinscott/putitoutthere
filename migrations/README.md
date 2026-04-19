# Migration audits

Per-repo audits of thekevinscott's projects that might adopt `putitoutthere`. Each doc follows the [`dirsql.md`](../notes/4-17-2026-initial-plan/migrations/dirsql.md) template:

1. TL;DR diff table.
2. Behavior changes to accept.
3. Target `putitoutthere.toml`.
4. Target `release.yml`.
5. Files to delete after migration.
6. Step-by-step migration plan.
7. Verification checklist.
8. Decisions locked in vs. left open.

## Outputs

- Per-repo migration docs (this directory).
- **Plan-gap audit**: for every unique pattern found, either confirm putitoutthere already supports it (via an existing `build` mode or mechanism) or file a follow-up issue. Gaps are tracked in [`PLAN_GAPS.md`](./PLAN_GAPS.md).

## Status

| Repo          | Status   | Doc                               |
|---------------|----------|-----------------------------------|
| dirsql        | Done     | `notes/4-17-2026-initial-plan/migrations/dirsql.md` (reference) |
| UpscalerJS    | Audited  | [`UpscalerJS.md`](./UpscalerJS.md) |
| curtaincall   | Audited  | [`curtaincall.md`](./curtaincall.md) |
| karat         | Audited  | [`karat.md`](./karat.md)          |
| skillet       | Audited  | [`skillet.md`](./skillet.md)      |
| cachetta      | Audited  | [`cachetta.md`](./cachetta.md)    |
| gbnf          | Audited  | [`gbnf.md`](./gbnf.md)            |

"Audited" = workflows, manifests, and repo structure have been read via public GitHub; the doc captures the observed shape and the target `putitoutthere.toml`. A small number of TODOs remain — all are details the repo owner resolves at cutover (e.g. "is this package really scoped `@thekevinscott/...` on npm today?"), not audit blockers.

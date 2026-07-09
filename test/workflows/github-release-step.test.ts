/**
 * Workflow-YAML contract: the `Create GitHub Release(s) for new tag(s)`
 * step in the reusable release workflow depends only on refs it owns —
 * the per-version tags the engine just created on HEAD.
 *
 * Why this exists: two production incidents against the same consumer
 * (thekevinscott/testing-conventions), one per fragility (#436):
 *
 * 1. 2026-07-09 (consumer run 29013882728): the step opened with a
 *    blanket, un-forced `git fetch --tags origin`. The consumer's
 *    promotion automation force-moved its floating `v0` tag between
 *    this job's checkout and this step, and git refused to update the
 *    diverged tag (`! [rejected] v0 -> v0 (would clobber existing
 *    tag)`) — failing the job after every registry publish and tag
 *    push had already succeeded. Consumer automation gates promotion
 *    on this job's conclusion, so the release was published but never
 *    promoted, and the job-level rerun then failed differently
 *    (empty plan), leaving no safe automated recovery.
 * 2. 2026-07-08 (consumer run 28956877468): the engine's tag push is
 *    warn-only by design (#407 — publish must not fail on a tag-push
 *    flake; auto-heal backfills on the next run), so this step met a
 *    local tag absent from the remote and `gh release create`
 *    hard-failed: `tag ... exists locally but has not been pushed`.
 *
 * The contract, pinned here:
 * - No `git fetch` inside the step. Local tag state is already
 *   complete: checkout (`fetch-depth: 0`) fetched every remote tag,
 *   and the tags this step iterates were created locally by the
 *   engine in this same job. A blanket fetch adds nothing except a
 *   dependency on every other tag in the consumer's repo — including
 *   moving major tags that legitimately move mid-run.
 * - Each tag is pushed ref-scoped and idempotently
 *   (`git push origin "refs/tags/$tag"`) before `gh release create`,
 *   so an engine-side warn-only push failure heals here in the same
 *   run instead of hard-failing one step later. A ref-scoped push is
 *   invisible to every other tag, and a genuine conflict (the same
 *   version tag at a different commit on the remote) still fails
 *   loudly — that means two runs released the same version, which
 *   the `putitoutthere-release-*` concurrency group exists to
 *   prevent.
 * - The `gh release view` guard stays, so re-runs skip existing
 *   Releases instead of erroring.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowsDir = join(
  fileURLToPath(new URL('../..', import.meta.url)),
  '.github/workflows',
);

interface WorkflowStep {
  name?: string;
  run?: string;
}
interface Workflow {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
}

const STEP_NAME = 'Create GitHub Release(s) for new tag(s)';

function releaseStepRun(): string {
  const wf = parseYaml(
    readFileSync(join(workflowsDir, 'release.yml'), 'utf8'),
  ) as Workflow;
  const step = Object.values(wf.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .find((s) => s.name === STEP_NAME);
  expect(
    step?.run,
    `release.yml must contain a run step named "${STEP_NAME}"`,
  ).toBeTypeOf('string');
  return step!.run!;
}

describe('release.yml: the Create-GitHub-Release step touches only refs it owns', () => {
  it('performs no git fetch (a blanket tag fetch fails on any concurrently moved tag it never uses)', () => {
    expect(
      /\bgit\s+fetch\b/.test(releaseStepRun()),
      `"${STEP_NAME}" must not run \`git fetch\`. Local tags are already complete ` +
        `(checkout fetched all remote tags; the engine created the new tags locally in this job), ` +
        `and an un-forced \`git fetch --tags\` rejects any tag that moved since checkout — a ` +
        `consumer's floating major tag moving mid-run fails the job after a fully successful publish.`,
    ).toBe(false);
  });

  it('pushes each tag ref-scoped before creating its GitHub Release', () => {
    const run = releaseStepRun();
    const pushIndex = run.search(/git push origin "refs\/tags\/\$tag"/);
    const createIndex = run.search(/gh release create "\$tag"/);
    expect(
      pushIndex,
      `"${STEP_NAME}" must run \`git push origin "refs/tags/$tag"\` for each tag. The engine's ` +
        `tag push is warn-only (#407), so without a ref-scoped, idempotent re-push here, ` +
        `\`gh release create\` hard-fails on a tag that never reached the remote.`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      createIndex,
      `"${STEP_NAME}" must still create the Release with \`gh release create "$tag"\``,
    ).toBeGreaterThanOrEqual(0);
    expect(
      pushIndex,
      `the ref-scoped tag push must run before \`gh release create\` so the Release is cut ` +
        `against a tag that is guaranteed to be on the remote`,
    ).toBeLessThan(createIndex);
  });

  it('keeps the gh release view idempotency guard ahead of gh release create', () => {
    const run = releaseStepRun();
    const viewIndex = run.search(/gh release view "\$tag"/);
    const createIndex = run.search(/gh release create "\$tag"/);
    expect(
      viewIndex,
      `"${STEP_NAME}" must keep the \`gh release view\` existence check so re-runs skip ` +
        `already-created Releases instead of erroring`,
    ).toBeGreaterThanOrEqual(0);
    expect(viewIndex).toBeLessThan(createIndex);
  });
});

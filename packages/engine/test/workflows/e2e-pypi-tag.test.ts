/**
 * The e2e lane must not stop at the PyPI upload (#718).
 *
 * `pypi-tag.yml` is consumer-facing, and `consumer-template.test.ts` pins
 * the template that tells consumers to paste it verbatim — but no job in
 * this repo ever ran it. The heavy lane is the only tier that publishes to
 * a real index, and it uploaded and stopped. That is why #694 — a
 * propagation race that made `reconcile` decide "nothing to do" and skip
 * the tag — shipped twice unseen.
 *
 * Both hops pinned here are silent when broken, which is what earns the
 * file (AGENTS.md > "Workflow-contract tests are earned"):
 *
 * - The tag job gates on `needs.pypi-publish.outputs.have_pypi`, because
 *   #294 discards the first-publish artifacts before upload and a run left
 *   with nothing published has nothing to tag. A job output the producer
 *   does not declare is not an error — it expands to the empty string, so
 *   the `if:` is false on every run, the job skips, and the lane stays
 *   green with the gap reopened.
 * - `expect:` carries what the upload shipped. An unknown step output also
 *   expands to the empty string, and `action.ts` guards `--expect` on
 *   non-empty — so an empty one does not fail the job, it falls back to
 *   exactly the project-pointer discovery that loses the tag.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: Step[];
}

function jobs(): Record<string, Job> {
  const wf = parseYaml(
    readFileSync(join(repoRoot, '.github/workflows/e2e-fixture.yml'), 'utf8'),
  ) as { jobs?: Record<string, Job> };
  return wf.jobs ?? {};
}

function tagJobSteps(): Step[] {
  const job = jobs()['pypi-tag'];
  expect(job, 'e2e-fixture.yml must run the pypi-tag job it tells consumers to wire').toBeDefined();
  return job?.steps ?? [];
}

describe('the e2e lane tags what it published to real PyPI (#718)', () => {
  it('pypi-publish exports the have_pypi output the tag job gates on', () => {
    expect(jobs()['pypi-publish']?.outputs?.have_pypi).toBe(
      '${{ steps.have-pypi.outputs.have_pypi }}',
    );
  });

  it('the tag job runs after pypi-publish, and only when something reached PyPI', () => {
    const job = jobs()['pypi-tag'];
    expect(job, 'e2e-fixture.yml must run the pypi-tag job it tells consumers to wire').toBeDefined();
    expect([job?.needs ?? []].flat()).toContain('pypi-publish');
    expect(job?.if ?? '').toContain("needs.pypi-publish.outputs.have_pypi == 'true'");
  });

  it('the tag job reconciles through the PR-built action with a step-sourced expectation', () => {
    const steps = tagJobSteps();
    const reconcile = steps.filter((s) => s.with?.command === 'reconcile');
    expect(reconcile, 'the tag job must invoke the reconcile command').toHaveLength(1);
    // `./`, not `@v0`: running this in the e2e lane is only worth the
    // minutes if the bundle under review is the one being exercised.
    expect(reconcile[0]?.uses).toBe('./');

    const expression = String(reconcile[0]?.with?.expect ?? '');
    const sourceId = /^\$\{\{\s*steps\.([\w-]+)\.outputs\.expect\s*\}\}$/.exec(expression)?.[1];
    expect(sourceId, `expect: must read a step output, got "${expression}"`).toBeDefined();
    expect(
      steps.map((s) => s.id),
      'the step expect: reads from must exist in this job',
    ).toContain(sourceId);
  });

  it('the tag job asserts a tag was cut, after reconcile ran', () => {
    const steps = tagJobSteps();
    const reconcileAt = steps.findIndex((s) => s.with?.command === 'reconcile');
    const assertAt = steps.findIndex((s) => (s.run ?? '').includes('pypi-tag-verify assert'));
    // reconcile exits 0 when it decides there is nothing to do — #694's
    // entire failure mode — so the upload is only observed if something
    // downstream reads the tags back.
    expect(assertAt, 'the tag job must assert the tag reconcile was asked to cut').toBeGreaterThan(
      -1,
    );
    expect(assertAt).toBeGreaterThan(reconcileAt);
  });
});

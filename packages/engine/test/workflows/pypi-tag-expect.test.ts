/**
 * The chain that carries "what the upload shipped" from the release job
 * to the tagging job must be unbroken, link by link (#694).
 *
 * `pypi-tag` cannot discover a fresh first publish: PyPI's project
 * pointer 404s until it propagates, and a 404 there is also the correct
 * permanent answer for a project that was never released, so reconcile
 * reads "unpublished", exits 0 with `actions: []`, and the tag is never
 * written (`agent-transcript-viewer 0.0.0`, twice). The fix is to tell
 * it: the release run already computed `{name, version, tag}` for every
 * delegated PyPI package, and that list travels
 *
 *     publish step output
 *       -> publish job `outputs:`
 *         -> release.yml `workflow_call.outputs`
 *           -> consumer's `pypi-tag` job `with: expect:`
 *             -> pypi-tag.yml's `expect` input
 *               -> the action's `expect` input
 *
 * Every hop is a GitHub Actions expression, and **a broken hop is
 * silent**: an unknown or undeclared output expands to the empty string,
 * `expect` arrives empty, the engine falls back to exactly the discovery
 * that loses the tag, and the job goes green. That is the
 * `publish-github-token` shape — absence degrades at runtime, invisibly
 * — so it earns a contract test, where a version pin would not. The one
 * hop not pinned here is the consumer's own job, which
 * `consumer-template.test.ts` holds byte-for-byte.
 *
 * Issue #694.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  outputs?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on?: { workflow_call?: { inputs?: Record<string, unknown>; outputs?: Record<string, { value?: string }> } };
  jobs?: Record<string, Job>;
}

function load(name: string): Workflow {
  return parseYaml(readFileSync(join(repoRoot, '.github/workflows', name), 'utf8')) as Workflow;
}

/**
 * `action.yml`'s declared input names. An undeclared `with:` key on a
 * composite/JS action is not an error — Actions ignores it and the
 * adapter sees no `INPUT_*`, which is the silent failure again.
 */
function actionInputs(): Record<string, unknown> {
  const manifest = parseYaml(readFileSync(join(repoRoot, 'action.yml'), 'utf8')) as {
    inputs?: Record<string, unknown>;
  };
  return manifest.inputs ?? {};
}

describe('delegated_packages reaches the pypi-tag reconcile step (#694)', () => {
  it('release.yml exposes delegated_packages as a workflow_call output', () => {
    // The consumer reads `needs.release.outputs.delegated_packages`. An
    // output the reusable workflow does not declare is not an error —
    // it is an empty string.
    const outputs = load('release.yml').on?.workflow_call?.outputs ?? {};

    expect(Object.keys(outputs)).toContain('delegated_packages');
    expect(outputs.delegated_packages?.value).toBe(
      '${{ jobs.publish.outputs.delegated_packages }}',
    );
  });

  it('release.yml propagates the publish step output to the publish job', () => {
    // Second hop of the same two-hop wiring `released_packages` uses:
    // the engine writes the key to $GITHUB_OUTPUT, the job must re-export
    // it or the workflow_call output above resolves to nothing.
    const publish = load('release.yml').jobs?.publish;

    expect(publish?.outputs?.delegated_packages).toBe(
      '${{ steps.publish.outputs.delegated_packages }}',
    );
  });

  it('pypi-tag.yml accepts an expect input and forwards it to the engine', () => {
    const wf = load('pypi-tag.yml');

    expect(Object.keys(wf.on?.workflow_call?.inputs ?? {})).toContain('expect');

    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const reconcile = steps.filter((s) => s.with?.command === 'reconcile');
    expect(reconcile, 'pypi-tag.yml must invoke the reconcile command').toHaveLength(1);
    expect(reconcile[0]?.with?.expect).toBe('${{ inputs.expect }}');
  });

  it('action.yml declares the expect input the step passes', () => {
    // Last hop: `with: expect:` on a JS action whose manifest has no
    // `expect` input sets no `INPUT_EXPECT`, so the adapter forwards no
    // `--expect` and reconcile silently discovers instead.
    expect(Object.keys(actionInputs())).toContain('expect');
  });
});

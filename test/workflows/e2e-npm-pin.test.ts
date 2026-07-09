/**
 * Workflow-YAML contract: the e2e fixture publish job pins the npm CLI
 * to an explicit major, never a floating `latest` (#438).
 *
 * Why this exists: `e2e-fixture-job.yml`'s "Pin npm to a
 * Trusted-Publishing-capable version" step ran
 * `npm install -g npm@latest`. When npm's `latest` dist-tag moved to
 * 12.0.0 (between the last green e2e run on 2026-07-05 and 2026-07-09),
 * every fixture publish on every PR started failing inside
 * `npm publish`:
 *
 *   npm error Cannot find module 'sigstore'
 *   npm error - .../npm/node_modules/libnpmpublish/lib/provenance.js
 *
 * npm 12.0.0's published bundle carries `libnpmpublish` (which declares
 * and requires the unscoped `sigstore` package) without an unscoped
 * `sigstore` anywhere on its resolution path — only `@sigstore/*`
 * scoped packages and a nested copy under `pacote/node_modules`. Every
 * provenance publish dies at module load. Nothing in this repo changed;
 * a floating external moved, CI went red with no commit to blame — the
 * same mutable-external failure class as #436's tag race.
 *
 * The contract: the step installs an explicitly-majored npm
 * (`npm install -g npm@<major>`), so a broken major published upstream
 * cannot break CI without a reviewed version-bump commit here. The
 * major must be Trusted-Publishing-capable (>= 11; TP landed in
 * 11.5.1) so the OIDC-TP exchange still engages on
 * `npm publish --provenance`.
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

const STEP_NAME = 'Pin npm to a Trusted-Publishing-capable version';

function npmPinStepRun(): string {
  const wf = parseYaml(
    readFileSync(join(workflowsDir, 'e2e-fixture-job.yml'), 'utf8'),
  ) as Workflow;
  const step = Object.values(wf.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .find((s) => s.name === STEP_NAME);
  expect(
    step?.run,
    `e2e-fixture-job.yml must contain a run step named "${STEP_NAME}"`,
  ).toBeTypeOf('string');
  return step!.run!;
}

describe('e2e-fixture-job.yml: the npm CLI install is pinned, not floating', () => {
  it('does not install npm@latest (a floating dist-tag breaks CI with no commit to blame)', () => {
    expect(
      /npm@latest/.test(npmPinStepRun()),
      `"${STEP_NAME}" must not install \`npm@latest\`. When the \`latest\` dist-tag moved to ` +
        `the broken 12.0.0 (bundled libnpmpublish requires 'sigstore', which is absent from ` +
        `npm 12.0.0's bundle), every fixture publish on every PR failed with MODULE_NOT_FOUND ` +
        `and no commit to blame.`,
    ).toBe(false);
  });

  it('installs an explicit, Trusted-Publishing-capable npm major (>= 11)', () => {
    const run = npmPinStepRun();
    const match = run.match(/npm install -g npm@(\d+)\b/);
    expect(
      match,
      `"${STEP_NAME}" must run \`npm install -g npm@<major>\` with an explicit major version, ` +
        `so an upstream release can only change CI's npm via a reviewed version-bump commit.`,
    ).not.toBeNull();
    expect(
      Number(match![1]),
      `the pinned npm major must support Trusted Publishing (landed in npm 11.5.1) so the ` +
        `OIDC-TP exchange engages on \`npm publish --provenance\``,
    ).toBeGreaterThanOrEqual(11);
  });
});

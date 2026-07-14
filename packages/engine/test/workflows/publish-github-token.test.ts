/**
 * Every workflow step that runs `putitoutthere publish` must expose
 * `GITHUB_TOKEN` in its `env:` block.
 *
 * Why: the `requireRepoPublic` preflight check (`src/preflight.ts`)
 * calls `https://api.github.com/repos/{owner}/{repo}` to confirm the
 * repo is public. `publish.ts` passes `githubToken:
 * process.env.GITHUB_TOKEN` to it — but GitHub Actions does not put
 * the token in the environment automatically. Without an explicit
 * `env: GITHUB_TOKEN:` on the step, the call goes out unauthenticated
 * (60 req/hr), and a multi-fixture e2e run blows that limit and gets a
 * 403 — which previously hard-failed the publish. Authenticated calls
 * get 5000 req/hr.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const workflowsDir = join(
  fileURLToPath(new URL('../../../..', import.meta.url)),
  '.github/workflows',
);

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}
interface Workflow {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
}

function load(name: string): Workflow {
  return parseYaml(readFileSync(join(workflowsDir, name), 'utf8')) as Workflow;
}

function steps(name: string): WorkflowStep[] {
  const wf = load(name);
  return Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
}

/** A step that invokes `putitoutthere publish`, in any of its forms. */
function isPublishStep(step: WorkflowStep): boolean {
  if (step.with?.command === 'publish') return true;
  // Dogfood workflows invoke the engine via its declared bin
  // (`pnpm exec putitoutthere publish`, #467), not a `dist/cli-bin.js`
  // path, so match the bin name rather than the old script path.
  if (typeof step.run === 'string' && /\bpublish\b/.test(step.run) &&
      /\bputitoutthere\b/.test(step.run)) {
    return true;
  }
  return false;
}

describe('publish steps must wire GITHUB_TOKEN into env', () => {
  for (const workflow of [
    'release.yml',
    'e2e-fixture-job.yml',
    'release-npm.yml',
  ]) {
    it(`${workflow}: every publish step sets env.GITHUB_TOKEN`, () => {
      const publishSteps = steps(workflow).filter(isPublishStep);
      expect(
        publishSteps.length,
        `${workflow} must contain at least one publish step`,
      ).toBeGreaterThan(0);
      for (const step of publishSteps) {
        const token = step.env?.['GITHUB_TOKEN'];
        expect(
          typeof token === 'string' && token.length > 0,
          `${workflow} publish step is missing env.GITHUB_TOKEN`,
        ).toBe(true);
      }
    });
  }
});

/**
 * Contract for the evidence-check workflow (#309, #354). The gate's decision
 * logic — the CHANGELOG.md diff, the Unreleased-bullet parsing, the accepted
 * evidence buckets, and the race-aware poll of cited workflow runs — was
 * extracted from inline bash into tested TypeScript under
 * `packages/ci/src/evidence-check/` (the `piot-ci evidence-check` command,
 * #445, epic #442); that behaviour is now pinned in the colocated
 * decide/run/unit tests there, not by scanning this YAML.
 *
 * What remains reviewer-invisible and therefore guarded here is the workflow
 * *wiring*: the permissions and env the extracted gate needs to run, and that
 * the workflow delegates to the `piot-ci` bin rather than reintroducing inline
 * logic. Dropping `actions: read` or `GH_TOKEN` would silently degrade the
 * `gh api` run lookups (unauthenticated / unauthorized) at runtime.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const workflowPath = join(repoRoot, '.github/workflows/evidence-check.yml');
const workflowExists = existsSync(workflowPath);
const describeWhenWorkflowExists = workflowExists ? describe : describe.skip;

function readWorkflow(): string {
  return readFileSync(workflowPath, 'utf8');
}

describe('#309 CHANGELOG evidence-check workflow', () => {
  it('exists', () => {
    expect(
      workflowExists,
      'issue #309 requires .github/workflows/evidence-check.yml for the CHANGELOG evidence gate',
    ).toBe(true);
  });
});

describeWhenWorkflowExists('#309 CHANGELOG evidence-check workflow contract', () => {
  it('runs on pull requests with read-only contents and actions permissions', () => {
    const text = readWorkflow();

    expect(text, 'evidence-check must run on pull requests').toMatch(
      /(?:^|\n)\s*pull_request:\s*(?:\n|$)/,
    );
    expect(text, 'evidence-check needs contents: read to diff CHANGELOG.md').toMatch(
      /(?:^|\n)permissions:\s*\n(?:\s+[a-z-]+:\s+\w+\s*\n)*\s+contents:\s+read/,
    );
    expect(text, 'evidence-check needs actions: read to inspect cited workflow runs').toMatch(
      /(?:^|\n)permissions:\s*\n(?:\s+[a-z-]+:\s+\w+\s*\n)*\s+actions:\s+read/,
    );
  });

  it('passes the pull request base and head SHAs, plus a token for the run lookups', () => {
    const text = readWorkflow();

    expect(text).toContain('BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(text).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    expect(
      text,
      'gh api run lookups must be authenticated (unauthenticated calls rate-limit)',
    ).toContain('GH_TOKEN: ${{ github.token }}');
  });

  it('delegates to the tested piot-ci gate rather than carrying inline logic', () => {
    const text = readWorkflow();

    expect(
      text,
      'the gate logic lives in packages/ci (piot-ci evidence-check), not inline bash',
    ).toMatch(/pnpm\s+exec\s+piot-ci\s+evidence-check/);
  });
});

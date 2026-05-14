/**
 * Red coverage for issue #309. The evidence-check workflow is intentionally
 * absent until the pre-merge CHANGELOG evidence gate is implemented.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
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

  it('diffs CHANGELOG.md against the pull request base and checks only new Unreleased bullets', () => {
    const text = readWorkflow();

    expect(text).toContain('BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(text).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    expect(text, 'the workflow should diff CHANGELOG.md, not scan historical entries').toMatch(
      /git\s+diff[\s\S]*\$\{?BASE_SHA\}?[\s\S]*\$\{?HEAD_SHA\}?[\s\S]*CHANGELOG\.md/,
    );
    expect(text, 'the workflow should scope enforcement to the Unreleased section').toMatch(
      /Unreleased/,
    );
  });

  it('accepts verified-by citations for every supported evidence bucket', () => {
    const text = readWorkflow();

    for (const bucket of ['e2e', 'integration', 'unit', 'consumer-template']) {
      expect(text, `evidence-check must accept the ${bucket}/ citation bucket`).toMatch(
        new RegExp(`\\b${bucket}/`),
      );
    }
  });

  it('fails missing or unknown verification clauses while allowing a reasoned no-fixture clause', () => {
    const text = readWorkflow();

    expect(text, 'missing verification clauses must be a hard failure').toMatch(
      /missing|without.*(?:verified by|no fixture)/i,
    );
    expect(text, 'unknown citation buckets must be a hard failure').toMatch(
      /unknown|unrecognized|unsupported/i,
    );
    expect(text, 'pure internal entries may opt out with a non-empty no-fixture reason').toMatch(
      /\(no fixture:\s*<reason>\)|no fixture/i,
    );
  });

  it('queries GitHub Actions for cited evidence on the pull request head SHA', () => {
    const text = readWorkflow();

    expect(text, 'cited evidence must be checked against this PR HEAD commit').toContain(
      '${{ github.event.pull_request.head.sha }}',
    );
    expect(text, 'the workflow should call the GitHub API or gh to inspect workflow/job status').toMatch(
      /gh\s+(?:api|run)|actions\/runs|listWorkflowRuns|workflow-runs/i,
    );
    expect(text, 'red or missing cited runs must fail the workflow').toMatch(
      /conclusion|status|success|completed/i,
    );
  });
});

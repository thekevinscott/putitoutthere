/**
 * Wiring contract for the CHANGELOG evidence-check gate (issues #309,
 * #354; extraction #445, epic #442).
 *
 * The gate's DECISION logic — bucket validation, missing-clause and
 * empty-reason failures, the poll/deadline race handling (#354) — now
 * lives in the tested, I/O-free `checkEvidence` orchestrator under
 * `src/ci/evidence-check/` and is covered by its colocated unit tests
 * plus `test/integration/evidence-check.integration.test.ts`. Those
 * contracts are NOT restated here.
 *
 * What this file guards is the WIRING that no unit test can see and a
 * diff reader can silently break: the workflow must build the engine
 * before invoking it (else `dist/` is missing and the boundary import
 * fails only on a PR run), must hand the boundary the PR base/head SHAs
 * and an authenticated `GH_TOKEN` (a missing token silently degrades to
 * rate-limited unauthenticated API calls), and the boundary must diff
 * CHANGELOG.md across the PR range, poll GitHub Actions via `gh`, and
 * delegate to the built `checkEvidence` rather than re-implementing it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const workflowPath = join(repoRoot, '.github/workflows/evidence-check.yml');
const boundaryPath = join(repoRoot, '.github/workflows/evidence-check.mjs');
const workflowExists = existsSync(workflowPath);
const describeWhenWorkflowExists = workflowExists ? describe : describe.skip;

function readWorkflow(): string {
  return readFileSync(workflowPath, 'utf8');
}

function readBoundary(): string {
  return readFileSync(boundaryPath, 'utf8');
}

describe('#309 CHANGELOG evidence-check workflow', () => {
  it('exists', () => {
    expect(
      workflowExists,
      'issue #309 requires .github/workflows/evidence-check.yml for the CHANGELOG evidence gate',
    ).toBe(true);
  });

  it('ships the extracted boundary script the workflow invokes', () => {
    expect(
      existsSync(boundaryPath),
      'the workflow delegates to .github/workflows/evidence-check.mjs',
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

  it('builds the engine before invoking the extracted checker', () => {
    const text = readWorkflow();

    // Without a build step the boundary's `import ... from '../../dist/...'`
    // resolves to a missing file and the gate errors on every PR — a
    // failure invisible in the workflow diff.
    const buildIndex = text.indexOf('pnpm build');
    const invokeIndex = text.indexOf('node .github/workflows/evidence-check.mjs');
    expect(buildIndex, 'the workflow must build dist/ before running the boundary').toBeGreaterThan(
      -1,
    );
    expect(invokeIndex, 'the workflow must invoke the boundary script via node').toBeGreaterThan(-1);
    expect(buildIndex, 'the build must precede the boundary invocation').toBeLessThan(invokeIndex);
  });

  it('hands the boundary the PR base/head SHAs and an authenticated token', () => {
    const text = readWorkflow();

    expect(text).toContain('BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(text).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
    // A missing GH_TOKEN silently falls back to unauthenticated `gh api`
    // calls that rate-limit — the same class of regression the
    // publish-github-token contract guards.
    expect(text, 'gh api needs GH_TOKEN to avoid unauthenticated rate limits').toMatch(
      /GH_TOKEN:\s*\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN)\s*\}\}/,
    );
  });

  it('diffs CHANGELOG.md across the PR range in the boundary', () => {
    const text = readBoundary();

    expect(
      text,
      'the boundary should diff CHANGELOG.md, not scan historical entries',
    ).toMatch(/git['"][\s\S]*diff[\s\S]*CHANGELOG\.md/);
    expect(text, 'the diff is scoped to the PR base..head range').toMatch(
      /baseSha[\s\S]*headSha|BASE_SHA[\s\S]*HEAD_SHA/,
    );
  });

  it('queries GitHub Actions via gh and polls with a real sleep in the boundary', () => {
    const text = readBoundary();

    expect(text, 'the boundary should call gh api to inspect workflow/job status').toMatch(
      /gh['"],\s*\[['"]api/,
    );
    // The race-aware wait (#354) is decided in checkEvidence; the boundary
    // must wire a real blocking sleep for it to actually pause between polls.
    expect(text, 'the boundary must wire a real sleep for the poll wait (#354)').toMatch(/sleep/i);
  });

  it('delegates the decision to the built checkEvidence rather than re-implementing it', () => {
    const text = readBoundary();

    expect(text, 'the boundary imports the extracted, tested orchestrator').toMatch(
      /import\s*\{\s*checkEvidence\s*\}\s*from\s*['"][^'"]*dist\/ci\/evidence-check\/index\.js['"]/,
    );
    expect(text, 'the boundary calls checkEvidence and exits with its code').toMatch(
      /checkEvidence\(/,
    );
    expect(text).toMatch(/process\.exit\(/);
  });
});

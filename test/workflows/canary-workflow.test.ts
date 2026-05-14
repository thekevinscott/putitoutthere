/**
 * Red coverage for issue #297. The canary workflow is intentionally absent
 * until the real-registry scheduled publish job is implemented.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const workflowPath = join(repoRoot, '.github/workflows/canary.yml');

function readWorkflow(): string {
  expect(
    existsSync(workflowPath),
    'issue #297 requires .github/workflows/canary.yml for the scheduled real-registry canary',
  ).toBe(true);
  return readFileSync(workflowPath, 'utf8');
}

describe('#297 scheduled real-registry canary workflow', () => {
  it('runs only on a weekly schedule or manual dispatch', () => {
    const text = readWorkflow();

    expect(text, 'canary must run on a weekly schedule').toMatch(
      /(?:^|\n)\s*schedule:\s*\n(?:\s*#.*\n)*\s*-\s*cron:\s*['"][^'"]+['"]/,
    );
    expect(text, 'canary must be manually triggerable').toMatch(
      /(?:^|\n)\s*workflow_dispatch:\s*(?:\n|$)/,
    );
    expect(text, 'canary must not run on PRs').not.toMatch(/(?:^|\n)\s*pull_request:/);
    expect(text, 'canary must not run on pushes').not.toMatch(/(?:^|\n)\s*push:/);
  });

  it('publishes through the public reusable release workflow path pinned to v0', () => {
    expect(readWorkflow(), 'canary must exercise the public reusable workflow consumers call').toMatch(
      /uses:\s*thekevinscott\/putitoutthere\/\.github\/workflows\/release\.yml@v0/,
    );
  });

  it('verifies npm and crates.io installs after publish', () => {
    const text = readWorkflow();

    expect(text, 'canary must verify the npm package installs from the registry').toMatch(
      /npm\s+(?:install|view)\s+@piot-canary\/main/,
    );
    expect(text, 'canary must verify the crates.io package installs or resolves').toMatch(
      /cargo\s+(?:add|search)\s+piot-canary/,
    );
  });
});

/**
 * A PyPI tag is cut by pypi-tag.yml, after release.yml's `release-github`
 * step has already run against a HEAD with no tag on it. Unless pypi-tag.yml
 * cuts the Release itself, none is ever created, and nothing fails (#798).
 * Order matters for the same reason: before `reconcile` there is no tag on
 * HEAD, and `release-github` exits 0 having done nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

interface Step {
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Workflow {
  jobs?: Record<string, { steps?: Step[] }>;
}

function steps(): Step[] {
  const wf = parseYaml(
    readFileSync(join(repoRoot, '.github/workflows/pypi-tag.yml'), 'utf8'),
  ) as Workflow;
  return Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
}

describe('pypi-tag.yml cuts the GitHub Release for the tag it writes (#798)', () => {
  it('runs release-github after reconcile, in the same job', () => {
    const commands = steps().map((s) => s.with?.command);

    expect(commands.indexOf('reconcile')).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('release-github')).toBeGreaterThan(commands.indexOf('reconcile'));
  });
});

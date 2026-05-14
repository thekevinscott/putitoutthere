/**
 * Issue #295: PyPI e2e coverage needs a real TestPyPI path in addition to
 * the existing mocked/local-registry fixture coverage. The workflow must
 * publish the Python fixtures to TestPyPI and then install/download the
 * published artifact back from TestPyPI so PyPI-specific upload semantics
 * and runtime packaging gaps are visible in CI.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  steps?: WorkflowStep[];
  strategy?: {
    matrix?: {
      fixture?: string[];
    };
  };
}

interface WorkflowYaml {
  jobs?: Record<string, WorkflowJob>;
}

function stringifyJob(id: string, job: WorkflowJob): string {
  return JSON.stringify({ id, ...job });
}

describe('#295 TestPyPI e2e coverage', () => {
  const e2ePath = join(repoRoot, '.github/workflows/e2e-fixture.yml');
  const e2e = parseYaml(readFileSync(e2ePath, 'utf8')) as WorkflowYaml;

  it('publishes the required Python fixtures to TestPyPI and verifies the uploaded artifacts', () => {
    const fixtures = e2e.jobs?.e2e?.strategy?.matrix?.fixture ?? [];
    expect(fixtures).toContain('python-rust-maturin');
    expect(fixtures).toContain('python-pure-hatch');

    const testPypiJobs = Object.entries(e2e.jobs ?? {}).filter(([id, job]) =>
      /test[-_ ]?pypi/i.test(stringifyJob(id, job)),
    );

    expect(
      testPypiJobs,
      'e2e-fixture.yml must define a TestPyPI variant/job for issue #295',
    ).not.toEqual([]);

    const testPypiWorkflowText = testPypiJobs.map(([id, job]) => stringifyJob(id, job)).join('\n');

    expect(
      testPypiWorkflowText,
      'TestPyPI upload must target Warehouse\'s TestPyPI legacy upload endpoint',
    ).toContain('https://test.pypi.org/legacy/');
    expect(
      testPypiWorkflowText,
      'TestPyPI verification must install or download from the TestPyPI simple index',
    ).toContain('https://test.pypi.org/simple/');
    expect(
      testPypiWorkflowText,
      'TestPyPI verification must inspect wheel metadata after downloading the published artifact',
    ).toMatch(/METADATA|pip download|pip install/);
  });
});

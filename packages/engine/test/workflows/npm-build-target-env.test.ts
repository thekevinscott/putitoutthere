import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

interface Step {
  if?: string;
  name?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  'working-directory'?: string;
  shell?: string;
}

function loadSteps(file: string, jobKey: string): Step[] {
  const path = join(repoRoot, '.github/workflows', file);
  const doc = parseYaml(readFileSync(path, 'utf8')) as {
    jobs: Record<string, { steps?: Step[] }>;
  };
  const job = doc.jobs[jobKey];
  if (!job) throw new Error(`${file}: job "${jobKey}" not found`);
  return job.steps ?? [];
}

function findNpmRunBuildStep(steps: Step[]): Step | undefined {
  return steps.find(
    (s) =>
      typeof s.if === 'string' &&
      /matrix\.kind\s*==\s*['"]npm['"]/.test(s.if) &&
      typeof s.run === 'string' &&
      /npm\s+run\s+build|putitoutthere npm-build/.test(s.run),
  );
}

describe('e2e harness: npm build step exposes VERSION env (#627)', () => {
  it('e2e-fixture-job.yml npm build step sets VERSION=${{ matrix.version }}', () => {
    const steps = loadSteps('e2e-fixture-job.yml', 'build');
    const step = findNpmRunBuildStep(steps);
    expect(step, 'e2e-fixture-job.yml: could not find npm `npm run build` step').toBeDefined();
    expect(
      step!.env!.VERSION,
      `e2e-fixture-job.yml: the internal e2e harness must pass VERSION too. When the fixture's env block and ` +
        `the consumer-facing \`_matrix.yml\` disagree, the fixture goes green on a contract real consumers ` +
        `never receive — exactly how #287 stayed invisible until a real first publish hit it.`,
    ).toBe('${{ matrix.version }}');
  });
});

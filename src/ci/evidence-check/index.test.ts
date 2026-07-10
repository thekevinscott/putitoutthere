import { describe, expect, it, vi } from 'vitest';

import { checkEvidence } from './index.js';
import type { CheckEvidenceDeps } from './types.js';

function changelogWith(bullets: string[]): string {
  return ['# Changelog', '', '## Unreleased', '', ...bullets, '', '## v0 → v1', ''].join('\n');
}

// A `git diff --unified=0` patch that adds `bullets` starting at line 5
// (the first line after `## Unreleased` + blank).
function diffAdding(bullets: string[]): string {
  return [
    '--- a/CHANGELOG.md',
    '+++ b/CHANGELOG.md',
    `@@ -4,0 +5,${bullets.length} @@`,
    ...bullets.map((b) => `+${b}`),
    '',
  ].join('\n');
}

interface Harness {
  logs: string[];
  sleeps: number[];
  deps: CheckEvidenceDeps;
}

function harness(over: Partial<CheckEvidenceDeps>): Harness {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const deps: CheckEvidenceDeps = {
    changelog: changelogWith([]),
    diff: '',
    baseSha: 'BASE',
    headSha: 'HEAD',
    repository: 'o/r',
    ghApi: () => ({ workflow_runs: [] }),
    sleepSeconds: (s: number) => sleeps.push(s),
    now: () => 0,
    log: (m: string) => logs.push(m),
    ...over,
  };
  return { logs, sleeps, deps };
}

describe('checkEvidence', () => {
  it('passes trivially and prints the success line when no bullets were added', () => {
    const { deps, logs } = harness({});
    expect(checkEvidence(deps)).toBe(0);
    expect(logs).toContain('Evidence check passed for CHANGELOG.md additions between BASE and HEAD.');
  });

  it('resolves evidence via job names, reusing the run and job caches', () => {
    const bullets = ['- x (verified by: e2e/a, e2e/b)'];
    const ghApi = vi.fn((path: string) => {
      if (path.includes('/jobs')) {
        return { jobs: [{ name: 'e2e a' }, { name: 'e2e b' }] };
      }
      return {
        workflow_runs: [
          { id: 7, name: 'Test', status: 'completed', conclusion: 'success' },
        ],
      };
    });
    const { deps } = harness({
      changelog: changelogWith(bullets),
      diff: diffAdding(bullets),
      ghApi,
    });

    expect(checkEvidence(deps)).toBe(0);
    // runs endpoint fetched once (cached), jobs endpoint fetched once (cached).
    const runsCalls = ghApi.mock.calls.filter(([p]) => !p.includes('/jobs')).length;
    const jobsCalls = ghApi.mock.calls.filter(([p]) => p.includes('/jobs')).length;
    expect(runsCalls).toBe(1);
    expect(jobsCalls).toBe(1);
  });

  it('polls until a pending citation resolves, logging progress and sleeping', () => {
    const bullets = ['- x (verified by: e2e/z)'];
    let runsFetches = 0;
    const ghApi = (path: string) => {
      if (path.includes('/jobs')) {
        return { jobs: [] };
      }
      runsFetches += 1;
      // First look: nothing yet. Second look: the cited run has succeeded.
      if (runsFetches === 1) {
        return { workflow_runs: [] };
      }
      return {
        workflow_runs: [{ id: 1, name: 'E2E Z', status: 'completed', conclusion: 'success' }],
      };
    };
    let clock = 0;
    const { deps, logs, sleeps } = harness({
      changelog: changelogWith(bullets),
      diff: diffAdding(bullets),
      ghApi,
      now: () => (clock++) * 1000,
      pollWindowMs: 1_000_000,
      pollIntervalMs: 30_000,
    });

    expect(checkEvidence(deps)).toBe(0);
    expect(sleeps).toEqual([30]);
    expect(logs.some((l) => /evidence-check: t\+\d+s — 1 citation\(s\) still pending/.test(l))).toBe(
      true,
    );
  });

  it('gives up polling at the deadline and fails the unresolved citation (jobs array absent)', () => {
    const bullets = ['- x (verified by: e2e/missing)'];
    // A run exists but never matches, so runMatches consults its jobs — and
    // the jobs endpoint omits the `jobs` array, exercising the `?? []` guard.
    const ghApi = (path: string) =>
      path.includes('/jobs') ? {} : { workflow_runs: [{ id: 5, name: 'Test' }] };
    let clock = 0;
    const { deps, logs } = harness({
      changelog: changelogWith(bullets),
      diff: diffAdding(bullets),
      ghApi,
      now: () => (clock++) * 1000,
      pollWindowMs: 2500,
    });

    expect(checkEvidence(deps)).toBe(1);
    expect(logs).toContain(
      "::error::CHANGELOG.md:5: no successful GitHub Actions run or job matched 'e2e/missing' on HEAD",
    );
  });

  it('tolerates a gh runs response with no workflow_runs array', () => {
    const bullets = ['- x (verified by: e2e/none)'];
    // The runs endpoint omits `workflow_runs`, exercising the `?? []` guard.
    const ghApi = (path: string) => (path.includes('/jobs') ? { jobs: [] } : {});
    let clock = 0;
    const { deps } = harness({
      changelog: changelogWith(bullets),
      diff: diffAdding(bullets),
      ghApi,
      now: () => (clock++) * 1000,
      pollWindowMs: 2500,
    });

    expect(checkEvidence(deps)).toBe(1);
  });
});

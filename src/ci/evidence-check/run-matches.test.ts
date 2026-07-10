import { describe, expect, it, vi } from 'vitest';

import { runMatches } from './run-matches.js';
import type { WorkflowRun } from './types.js';

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({ id: 42, ...over });

describe('runMatches', () => {
  it('matches on a normalized run field without consulting jobs', () => {
    const jobsForRun = vi.fn(() => []);
    expect(runMatches(run({ name: 'E2E / js-vanilla' }), 'e2e/js-vanilla', jobsForRun)).toBe(true);
    expect(jobsForRun).not.toHaveBeenCalled();
  });

  it('matches on display_title, path, or event fields', () => {
    const jobsForRun = vi.fn(() => []);
    expect(runMatches(run({ path: '.github/workflows/e2e.yml' }), 'e2e', jobsForRun)).toBe(true);
  });

  it('falls back to job names when no run field matches', () => {
    const jobsForRun = vi.fn(() => [{ name: 'integration (ubuntu-latest)' }]);
    expect(runMatches(run({ name: 'Test' }), 'integration', jobsForRun)).toBe(true);
    expect(jobsForRun).toHaveBeenCalledWith(42);
  });

  it('returns false when neither run fields nor jobs match', () => {
    const jobsForRun = vi.fn(() => [{ name: 'lint' }]);
    expect(runMatches(run({ name: 'Test' }), 'e2e/x', jobsForRun)).toBe(false);
  });
});

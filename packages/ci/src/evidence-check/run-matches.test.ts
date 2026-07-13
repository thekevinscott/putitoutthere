import { describe, expect, it, vi } from 'vitest';

import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { runMatches } from './run-matches.js';

const noJobs = (): readonly WorkflowJob[] => [];

describe('runMatches', () => {
  it('matches on the run name without consulting jobs', () => {
    const jobsForRun = vi.fn(noJobs);
    const run: WorkflowRun = { id: 1, name: 'Unit (ubuntu-latest)' };
    expect(runMatches(run, 'unit', jobsForRun)).toBe(true);
    expect(jobsForRun).not.toHaveBeenCalled();
  });

  it('matches on display_title', () => {
    const run: WorkflowRun = { id: 2, display_title: 'e2e js-vanilla' };
    expect(runMatches(run, 'e2e/js-vanilla', noJobs)).toBe(true);
  });

  it('matches on path', () => {
    const run: WorkflowRun = { id: 3, path: '.github/workflows/integration.yml' };
    expect(runMatches(run, 'integration', noJobs)).toBe(true);
  });

  it('matches on event', () => {
    const run: WorkflowRun = { id: 4, event: 'consumer-template' };
    expect(runMatches(run, 'consumer-template', noJobs)).toBe(true);
  });

  it('falls back to job names when no run field matches', () => {
    const jobsForRun = vi.fn((id: number): readonly WorkflowJob[] => {
      expect(id).toBe(5);
      return [{ name: 'integration (node 24)' }];
    });
    const run: WorkflowRun = { id: 5, name: 'CI umbrella' };
    expect(runMatches(run, 'integration', jobsForRun)).toBe(true);
    expect(jobsForRun).toHaveBeenCalledWith(5);
  });

  it('returns false when neither run fields nor jobs match', () => {
    const run: WorkflowRun = { id: 6, name: 'lint' };
    expect(runMatches(run, 'unit', () => [{ name: 'typecheck' }])).toBe(false);
  });
});

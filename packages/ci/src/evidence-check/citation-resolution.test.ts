import { describe, expect, it } from 'vitest';

import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { citationResolution } from './citation-resolution.js';

const noJobs = (): readonly WorkflowJob[] => [];

describe('citationResolution', () => {
  it('is pending when no run matches the citation', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success' }];
    expect(citationResolution('unit', runs, noJobs)).toBe('pending');
  });

  it('is passed when a matching run completed successfully', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'unit', status: 'completed', conclusion: 'success' }];
    expect(citationResolution('unit', runs, noJobs)).toBe('passed');
  });

  it('is failed when every matching run is terminal and none passed', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'unit', status: 'completed', conclusion: 'failure' }];
    expect(citationResolution('unit', runs, noJobs)).toBe('failed');
  });

  it('is pending when a matching run is still in progress', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'unit', status: 'in_progress', conclusion: null }];
    expect(citationResolution('unit', runs, noJobs)).toBe('pending');
  });

  it('is passed when one match succeeded even though another is still running', () => {
    const runs: WorkflowRun[] = [
      { id: 1, name: 'unit a', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'unit b', status: 'in_progress', conclusion: null },
    ];
    expect(citationResolution('unit', runs, noJobs)).toBe('passed');
  });

  it('is pending when a match failed but another is still running (not yet terminal)', () => {
    const runs: WorkflowRun[] = [
      { id: 1, name: 'unit a', status: 'completed', conclusion: 'failure' },
      { id: 2, name: 'unit b', status: 'queued', conclusion: null },
    ];
    expect(citationResolution('unit', runs, noJobs)).toBe('pending');
  });
});

import { describe, expect, it } from 'vitest';

import { citationResolution } from './citation-resolution.js';
import type { WorkflowRun } from './types.js';

const noJobs = () => [];

describe('citationResolution', () => {
  it("is 'pending' when no run matches the citation", () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'Lint', status: 'completed', conclusion: 'success' }];
    expect(citationResolution('e2e/x', runs, noJobs)).toBe('pending');
  });

  it("is 'passed' when a matching run completed successfully", () => {
    const runs: WorkflowRun[] = [
      { id: 1, name: 'E2E', status: 'completed', conclusion: 'success' },
    ];
    expect(citationResolution('e2e', runs, noJobs)).toBe('passed');
  });

  it("is 'failed' when every matching run is terminal and none succeeded", () => {
    const runs: WorkflowRun[] = [
      { id: 1, name: 'E2E', status: 'completed', conclusion: 'failure' },
    ];
    expect(citationResolution('e2e', runs, noJobs)).toBe('failed');
  });

  it("is 'pending' when a matching run is still in progress", () => {
    const runs: WorkflowRun[] = [
      { id: 1, name: 'E2E', status: 'in_progress', conclusion: null },
    ];
    expect(citationResolution('e2e', runs, noJobs)).toBe('pending');
  });
});

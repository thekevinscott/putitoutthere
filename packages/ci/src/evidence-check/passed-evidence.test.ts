import { describe, expect, it } from 'vitest';

import type { WorkflowJob, WorkflowRun } from './evidence-check-types.js';
import { passedEvidence } from './passed-evidence.js';

const noJobs = (): readonly WorkflowJob[] => [];

describe('passedEvidence', () => {
  it('is true for a matching run that completed successfully', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'unit', status: 'completed', conclusion: 'success' }];
    expect(passedEvidence('unit', runs, noJobs)).toBe(true);
  });

  it('is false when the successful run does not match the citation', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success' }];
    expect(passedEvidence('unit', runs, noJobs)).toBe(false);
  });

  it('is false when a matching run completed but did not succeed', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'unit', status: 'completed', conclusion: 'failure' }];
    expect(passedEvidence('unit', runs, noJobs)).toBe(false);
  });

  it('is false when a matching run has not completed', () => {
    const runs: WorkflowRun[] = [{ id: 1, name: 'unit', status: 'in_progress', conclusion: null }];
    expect(passedEvidence('unit', runs, noJobs)).toBe(false);
  });

  it('finds a matching success among non-matching successes', () => {
    const runs: WorkflowRun[] = [
      { id: 1, name: 'lint', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'unit', status: 'completed', conclusion: 'success' },
    ];
    expect(passedEvidence('unit', runs, noJobs)).toBe(true);
  });
});

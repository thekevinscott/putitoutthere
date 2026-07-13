import { describe, expect, it } from 'vitest';

import { isSuccessfulRun } from './is-successful-run.js';

describe('isSuccessfulRun', () => {
  it('is true for a completed, successful run', () => {
    expect(isSuccessfulRun({ id: 1, status: 'completed', conclusion: 'success' })).toBe(true);
  });

  it('is false for a completed run that did not succeed', () => {
    expect(isSuccessfulRun({ id: 1, status: 'completed', conclusion: 'failure' })).toBe(false);
  });

  it('is false for a run that has not completed, even if it would succeed', () => {
    expect(isSuccessfulRun({ id: 1, status: 'in_progress', conclusion: 'success' })).toBe(false);
  });

  it('is false for a run with no conclusion yet', () => {
    expect(isSuccessfulRun({ id: 1, status: 'in_progress', conclusion: null })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { pollPendingMessage } from './poll-message.js';

describe('pollPendingMessage', () => {
  it('renders the elapsed time, count, and joined citations', () => {
    expect(pollPendingMessage(42, ['e2e/a', 'unit/b'])).toBe(
      'evidence-check: t+42s — 2 citation(s) still pending (no matching workflow_run yet, ' +
        'or matches still in_progress / queued): e2e/a, unit/b',
    );
  });

  it('renders a single pending citation at t+0s', () => {
    expect(pollPendingMessage(0, ['integration/x'])).toBe(
      'evidence-check: t+0s — 1 citation(s) still pending (no matching workflow_run yet, ' +
        'or matches still in_progress / queued): integration/x',
    );
  });
});

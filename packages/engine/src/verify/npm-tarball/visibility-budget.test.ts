import { afterEach, describe, expect, it, vi } from 'vitest';

import { NPM_VISIBILITY_DEADLINE_MS, npmVisibilityBudget } from './visibility-budget.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('npmVisibilityBudget', () => {
  it('gives public npm a 20-minute deadline from now (#785)', () => {
    vi.useFakeTimers({ now: 1_000 });
    expect(NPM_VISIBILITY_DEADLINE_MS).toBe(1_200_000);
    expect(npmVisibilityBudget(undefined)).toEqual({ sleeps: [5, 15, 30, 60], deadline: 1_201_000 });
  });

  it('gives an override registry a short schedule and no deadline', () => {
    expect(npmVisibilityBudget('http://localhost:4873')).toEqual({ sleeps: [1, 2, 5, 10] });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './sleep.js';

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after a zero delay', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('clamps a negative delay and still resolves', async () => {
    await expect(sleep(-100)).resolves.toBeUndefined();
  });

  it('resolves after a small positive delay', async () => {
    await expect(sleep(5)).resolves.toBeUndefined();
  });

  it('waits the full positive delay — the clamp is Math.max, not Math.min', async () => {
    // With `Math.min(0, ms)` the timer would fire at 0 for any positive `ms`,
    // resolving immediately; `Math.max(0, ms)` must schedule the real 50ms.
    vi.useFakeTimers();
    let done = false;
    void sleep(50).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

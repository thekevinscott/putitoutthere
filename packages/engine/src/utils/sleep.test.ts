import { afterEach, describe, expect, it, vi } from 'vitest';
import { sleep } from './sleep.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('sleep', () => {
  it('resolves after a zero delay', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('clamps a negative delay and still resolves', async () => {
    await expect(sleep(-100)).resolves.toBeUndefined();
  });

  it('resolves after a small positive delay', async () => {
    await expect(sleep(5)).resolves.toBeUndefined();
  });

  it('waits for the full positive delay before resolving', async () => {
    // Pins `Math.max(0, ms)`: a `Math.min(0, ms)` mutant would clamp a
    // positive delay to 0 and resolve immediately at t=0.
    vi.useFakeTimers();
    let resolved = false;
    void sleep(50).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(49);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});

import { vi } from 'vitest';

export async function withFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    const p = fn();
    let done = false;
    void p.then(
      () => { done = true; },
      () => { done = true; },
    );
    while (!done) {
      await vi.advanceTimersByTimeAsync(200_000);
      await Promise.resolve();
    }
    return await p;
  } finally {
    vi.useRealTimers();
  }
}

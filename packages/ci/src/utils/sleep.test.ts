import { describe, expect, it } from 'vitest';
import { sleep } from './sleep.js';

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
});

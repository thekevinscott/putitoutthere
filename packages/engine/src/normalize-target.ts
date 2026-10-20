import type { TargetEntry } from './types.js';

/**
 * Normalizes a `TargetEntry` into its canonical object shape. Callers
 * that only need the triple can destructure; callers that drive the CI
 * matrix read `.runner` and fall back to the hardcoded mapping when
 * it's absent.
 */
export function normalizeTarget(entry: TargetEntry): { triple: string; runner?: string } {
  if (typeof entry === 'string') {return { triple: entry };}
  return entry.runner !== undefined
    ? { triple: entry.triple, runner: entry.runner }
    : { triple: entry.triple };
}

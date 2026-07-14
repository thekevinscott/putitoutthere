/**
 * Pins which post-image paths the patch-coverage gate (#468) counts added
 * lines for. Reproduces the `.mjs`'s two skip filters:
 *   - `/\.test\.ts$|\.d\.ts$/` (test and declaration files never count), and
 *   - `!currentFile.startsWith('packages/engine/src/') || !currentFile.endsWith('.ts')`
 *     (only engine `src/**` TypeScript counts).
 * Pure; exact boolean assertions.
 */

import { describe, expect, it } from 'vitest';

import { isCountedSrcPath } from './is-counted-src-path.js';

describe('isCountedSrcPath', () => {
  it('counts an engine src TypeScript file', () => {
    expect(isCountedSrcPath('packages/engine/src/plan.ts')).toBe(true);
  });

  it('counts a nested engine src TypeScript file', () => {
    expect(isCountedSrcPath('packages/engine/src/verify/crate/run.ts')).toBe(true);
  });

  it('does not count a *.test.ts file even under engine src', () => {
    expect(isCountedSrcPath('packages/engine/src/plan.test.ts')).toBe(false);
  });

  it('does not count a *.d.ts file even under engine src', () => {
    expect(isCountedSrcPath('packages/engine/src/types.d.ts')).toBe(false);
  });

  it('does not count a file outside packages/engine/src/', () => {
    expect(isCountedSrcPath('packages/ci/src/cli.ts')).toBe(false);
  });

  it('does not count a non-.ts file under engine src', () => {
    expect(isCountedSrcPath('packages/engine/src/data.json')).toBe(false);
  });

  it('does not count a path that only starts with the prefix without the slash boundary', () => {
    expect(isCountedSrcPath('packages/engine/srcextra/plan.ts')).toBe(false);
  });

  it('does not count a bare README even at repo root', () => {
    expect(isCountedSrcPath('README.md')).toBe(false);
  });
});

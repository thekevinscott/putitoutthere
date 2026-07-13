/**
 * Composition-root wiring test for `testpypi-verify assert`. Mocks the OS
 * boundary (`node:fs`) and `./assert-artifacts.js`, isolating the plumbing:
 * the `dist/` file listing (directories filtered out), the decision call, the
 * line printing, and the returned exit code.
 */

import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideAssertArtifacts } from './assert-artifacts.js';
import { runTestpypiAssert } from './run-assert.js';

vi.mock('node:fs');
vi.mock('./assert-artifacts.js');

const readdir = vi.mocked(readdirSync);
const decide = vi.mocked(decideAssertArtifacts);
const out: string[] = [];

function dirent(name: string, file: boolean): { name: string; isFile: () => boolean } {
  return { name, isFile: () => file };
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  readdir.mockReturnValue([
    dirent('a.whl', true),
    dirent('nested', false),
    dirent('b.tar.gz', true),
  ] as unknown as ReturnType<typeof readdirSync>);
  decide.mockReturnValue({ lines: ['dist/a.whl', '::error::missing x'], exitCode: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runTestpypiAssert', () => {
  it('lists dist files (directories filtered), decides, prints the lines, and returns the exit code', () => {
    expect(runTestpypiAssert()).toBe(1);
    expect(readdir).toHaveBeenCalledWith('dist', { withFileTypes: true });
    expect(decide).toHaveBeenCalledWith(['a.whl', 'b.tar.gz']);
    expect(out.join('')).toBe('dist/a.whl\n::error::missing x\n');
  });

  it('returns 0 and prints only the listing when the decision passes', () => {
    decide.mockReturnValue({ lines: ['dist/a.whl'], exitCode: 0 });
    expect(runTestpypiAssert()).toBe(0);
    expect(out.join('')).toBe('dist/a.whl\n');
  });
});

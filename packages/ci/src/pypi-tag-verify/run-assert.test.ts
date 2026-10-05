/**
 * Composition-root wiring test for `pypi-tag-verify assert`. Mocks the OS
 * boundary (`node:fs/promises`, `execCapture`) and the two pure cores,
 * isolating the plumbing: the `dist/` listing, the tag read out of the
 * throwaway tree, the line printing, and the exit code.
 */

import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { decideAssertExpectedTags } from './assert-expected-tags.js';
import { runPypiTagAssert } from './run-assert.js';
import { decideUploadedExpectations } from './uploaded-expectations.js';

vi.mock('node:fs/promises');
vi.mock('../utils/exec-capture.js');
vi.mock('./assert-expected-tags.js');
vi.mock('./uploaded-expectations.js');

const readdirMock = vi.mocked(readdir);
const capture = vi.mocked(execCapture);
const derive = vi.mocked(decideUploadedExpectations);
const decide = vi.mocked(decideAssertExpectedTags);
const out: string[] = [];

const TREE = '/runner/_temp/piot-pypi-tag';
const EXPECTATIONS = [{ name: 'pkg', version: '0.0.1', tag: 'pkg-v0.0.1' }];

function dirent(name: string, file: boolean): { name: string; isFile: () => boolean } {
  return { name, isFile: () => file };
}

function stubCapture(stdout: string): void {
  capture.mockResolvedValue({ stdout, stderr: '' });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  readdirMock.mockResolvedValue([
    dirent('pkg-0.0.1.tar.gz', true),
    dirent('nested', false),
  ] as unknown as Awaited<ReturnType<typeof readdir>>);
  derive.mockReturnValue({ expectations: EXPECTATIONS });
  decide.mockReturnValue({ lines: ['  tagged: pkg-v0.0.1'], exitCode: 0 });
  stubCapture('pkg-v0.0.1\n');
  process.env.TAG_TREE = TREE;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TAG_TREE;
});

describe('runPypiTagAssert', () => {
  it('re-derives from dist/, reads the throwaway tree tags, and returns the exit code', async () => {
    await expect(runPypiTagAssert()).resolves.toBe(0);
    expect(readdirMock).toHaveBeenCalledWith('dist', { withFileTypes: true });
    expect(derive).toHaveBeenCalledWith(['pkg-0.0.1.tar.gz']);
    expect(capture).toHaveBeenCalledWith('git', ['tag', '-l'], { cwd: TREE });
    expect(decide).toHaveBeenCalledWith(EXPECTATIONS, ['pkg-v0.0.1']);
    expect(out.join('')).toBe('  tagged: pkg-v0.0.1\n');
  });

  it('splits the tag list into trimmed, non-empty names', async () => {
    // `git tag -l` on an empty repo prints nothing, and its output always
    // ends in a newline — a blank entry would look like a real tag name.
    stubCapture('  pkg-v0.0.1  \nother\n\n');
    await expect(runPypiTagAssert()).resolves.toBe(0);
    expect(decide).toHaveBeenCalledWith(EXPECTATIONS, ['pkg-v0.0.1', 'other']);
  });

  it('returns the failing exit code and prints every line', async () => {
    decide.mockReturnValue({ lines: ['::error::a', '::error::b'], exitCode: 1 });
    await expect(runPypiTagAssert()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::a\n::error::b\n');
  });

  it('fails on the derivation error, without reading any tags', async () => {
    derive.mockReturnValue({ errorLine: 'pypi-tag-verify: nope' });
    await expect(runPypiTagAssert()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::pypi-tag-verify: nope\n');
    expect(capture).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('fails when TAG_TREE is %s, before listing dist/', async (_label, value) => {
    if (value === undefined) {
      delete process.env.TAG_TREE;
    } else {
      process.env.TAG_TREE = value;
    }
    await expect(runPypiTagAssert()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::pypi-tag-verify: TAG_TREE must be set.\n');
    expect(readdirMock).not.toHaveBeenCalled();
  });
});

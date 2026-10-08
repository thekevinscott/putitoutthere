import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, expect, it, vi } from 'vitest';

import { runDiscardFirstPublishDists } from './run.js';

vi.mock('node:fs/promises');

let out: string;

const entry = (name: string, file = true): unknown => ({ name, isFile: () => file });

beforeEach(() => {
  out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((out += String(s)), true));
  vi.mocked(rm).mockResolvedValue();
});

it('removes only first-publish files from dist/ and warns once', async () => {
  vi.mocked(readdir).mockResolvedValue([
    entry('a_placeholder-1.whl'),
    entry('b-placeholder-1.tar.gz'),
    entry('c_placeholder', false),
    entry('keep-1.whl'),
  ] as never);
  await expect(runDiscardFirstPublishDists()).resolves.toBe(0);
  expect(readdir).toHaveBeenCalledWith('dist', { withFileTypes: true });
  expect(vi.mocked(rm).mock.calls).toEqual([[join('dist', 'a_placeholder-1.whl')], [join('dist', 'b-placeholder-1.tar.gz')]]);
  expect(out).toMatch(/^ {2}dropped: a_placeholder-1\.whl\n {2}dropped: b-placeholder-1\.tar\.gz\n::warning::Dropped 2 .*\n$/);
});

it('is a silent no-op when dist/ is missing', async () => {
  vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
  await expect(runDiscardFirstPublishDists()).resolves.toBe(0);
  expect(rm).not.toHaveBeenCalled();
  expect(out).toBe('');
});

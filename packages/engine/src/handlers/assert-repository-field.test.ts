import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertRepositoryField } from './assert-repository-field.js';

vi.mock('node:fs/promises');

const readMock = vi.mocked(readFile);
const manifest = join('/repo/pkg', 'package.json');

function repository(value: unknown): void {
  readMock.mockResolvedValue(JSON.stringify({ name: 'pkg', repository: value }));
}

beforeEach(() => {
  readMock.mockReset();
});

describe('assertRepositoryField', () => {
  it.each([
    ['a non-empty string', 'https://github.com/o/r'],
    ['an object with a url', { type: 'git', url: 'https://github.com/o/r' }],
  ])('accepts %s', async (_label, value) => {
    repository(value);
    await expect(assertRepositoryField('/repo/pkg')).resolves.toBeUndefined();
    expect(readMock).toHaveBeenCalledWith(manifest, 'utf8');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a blank string', '   '],
    ['an object without a url', { type: 'git' }],
    ['an object with a blank url', { url: ' ' }],
    ['an object with a non-string url', { url: 1 }],
    ['a number', 1],
  ])('rejects %s', async (_label, value) => {
    repository(value);
    await expect(assertRepositoryField('/repo/pkg')).rejects.toThrow(
      `[PIOT_NPM_MISSING_REPOSITORY] npm publish --provenance requires a non-empty \`repository\` field in ${manifest}. ` +
        'See https://github.com/thekevinscott/putitoutthere#kind--npm.',
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { firstFileUnder } from './first-file-under.js';
import { pickMainFile } from './pick-main-file.js';

vi.mock('./first-file-under.js');

const firstFileMock = vi.mocked(firstFileUnder);

beforeEach(() => {
  firstFileMock.mockReset();
});

describe('pickMainFile', () => {
  it('napi: picks the .node file when present', async () => {
    expect(await pickMainFile('/stage', ['README.md', 'demo.linux-x64-gnu.node'], 'napi')).toBe(
      'demo.linux-x64-gnu.node',
    );
    expect(firstFileMock).not.toHaveBeenCalled();
  });

  it('napi: falls back to the first file when no .node is present', async () => {
    expect(await pickMainFile('/stage', ['only-file.txt', 'other.txt'], 'napi')).toBe('only-file.txt');
  });

  it('bundled-cli: searches the non-package.json entries under the staged dir', async () => {
    firstFileMock.mockResolvedValue('bin/demo-cli');
    expect(await pickMainFile('/stage', ['package.json', 'bin', 'README.md'], 'bundled-cli')).toBe(
      'bin/demo-cli',
    );
    expect(firstFileMock).toHaveBeenCalledWith('/stage', ['bin', 'README.md']);
  });

  it('bundled-cli: falls back to the first file when no entry resolves to a file', async () => {
    firstFileMock.mockResolvedValue(undefined);
    expect(await pickMainFile('/stage', ['package.json'], 'bundled-cli')).toBe('package.json');
  });
});

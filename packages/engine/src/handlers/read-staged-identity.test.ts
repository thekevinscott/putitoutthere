import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { readStagedIdentity } from './read-staged-identity.js';

vi.mock('node:fs/promises');

describe('readStagedIdentity', () => {
  it('returns only name and version from the staged package.json', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ name: 'demo-cli-linux-x64-gnu', version: '0.2.0', os: ['linux'] }),
    );
    await expect(readStagedIdentity('/tmp/stage')).resolves.toEqual({
      name: 'demo-cli-linux-x64-gnu',
      version: '0.2.0',
    });
    expect(readFile).toHaveBeenCalledWith(join('/tmp/stage', 'package.json'), 'utf8');
  });
});

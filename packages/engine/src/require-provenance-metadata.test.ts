import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { checkProvenanceMetadata } from './check-provenance-metadata.js';
import { requireProvenanceMetadata } from './require-provenance-metadata.js';

vi.mock('./check-provenance-metadata.js');

const checkMock = vi.mocked(checkProvenanceMetadata);
const packages = [{ name: 'web', kind: 'npm' }] as unknown as readonly Package[];

async function thrownMessage(): Promise<string> {
  try {
    await requireProvenanceMetadata(packages);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected requireProvenanceMetadata to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requireProvenanceMetadata', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue([]);
    await expect(requireProvenanceMetadata(packages)).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(packages);
  });

  it('throws one error listing every failing package with its reason', async () => {
    checkMock.mockResolvedValue([
      { package: 'a', packageJsonPath: 'a/package.json', reason: 'missing' },
      { package: 'b', packageJsonPath: 'b/package.json', reason: 'empty' },
    ]);
    const lines = (await thrownMessage()).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '[PIOT_NPM_MISSING_REPOSITORY] npm publish requires a non-empty `repository` field in package.json.',
      '',
      'Failing packages:',
      '  - a: a/package.json (missing)',
      '  - b: b/package.json (empty)',
    ]);
  });

  it('ends with the canonical repository shape and the docs pointer', async () => {
    checkMock.mockResolvedValue([
      { package: 'a', packageJsonPath: 'a/package.json', reason: 'empty' },
    ]);
    const lines = (await thrownMessage()).split('\n');
    expect(lines.slice(4)).toEqual([
      '',
      'Why: `npm publish --provenance` (used by putitoutthere on the OIDC trusted-publisher',
      'path) hard-requires this field so npm can verify the package was built from the repo',
      'the trusted publisher declares.',
      '',
      'Fix: add a `repository` block to each failing package.json. Canonical shape:',
      '',
      '  {',
      '    "repository": {',
      '      "type": "git",',
      '      "url": "git+https://github.com/<owner>/<repo>.git",',
      '      "directory": "<path/to/package>"',
      '    }',
      '  }',
      '',
      'See https://github.com/thekevinscott/putitoutthere#kind--npm.',
    ]);
  });
});

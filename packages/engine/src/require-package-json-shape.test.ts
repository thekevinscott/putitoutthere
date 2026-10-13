import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPackageJsonShape } from './check-package-json-shape.js';
import type { Package } from './config.js';
import { requirePackageJsonShape } from './require-package-json-shape.js';

vi.mock('./check-package-json-shape.js');

const checkMock = vi.mocked(checkPackageJsonShape);
const packages = [{ name: 'js/foo', kind: 'npm' }] as unknown as readonly Package[];

async function thrownMessage(): Promise<string> {
  try {
    await requirePackageJsonShape(packages);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected requirePackageJsonShape to throw');
}

beforeEach(() => {
  checkMock.mockReset();
});

describe('requirePackageJsonShape', () => {
  it('returns silently when the check finds nothing', async () => {
    checkMock.mockResolvedValue([]);
    await expect(requirePackageJsonShape(packages)).resolves.toBeUndefined();
    expect(checkMock).toHaveBeenCalledWith(packages);
  });

  it('throws naming the failing package + the error code', async () => {
    checkMock.mockResolvedValue([
      {
        package: 'js/foo',
        packageJsonPath: 'foo/package.json',
        code: 'PIOT_NPM_NAME_MISMATCH',
        detail: 'name = "foo" but configured name is "js/foo"',
      },
    ]);
    expect((await thrownMessage()).split('\n')).toEqual([
      'Pre-flight package.json shape check failed:',
      '',
      '  [PIOT_NPM_NAME_MISMATCH] js/foo: foo/package.json',
      '    name = "foo" but configured name is "js/foo"',
      '',
      'Why: `npm publish` packs the `name` from package.json, but the engine\'s',
      'idempotency probe (`npm view <name>`) and the tag/URL bookkeeping use the',
      'configured [[package]].name (or the `npm` override) — a divergence breaks',
      'idempotency and can publish under an unexpected name.',
      'Fix the package.json `name` or set the `npm` override in putitoutthere.toml, then re-run.',
    ]);
  });
});

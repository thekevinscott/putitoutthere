/**
 * `findCrateFile` — recursive, non-empty `.crate` lookup (#449). Isolated:
 * `listFilesRecursive` and `node:fs` (`statSync`) are mocked so each branch
 * is driven by return values, not real temp files. Real on-disk lookup is
 * covered by tests/integration/verify-crate.integration.test.ts and e2e.
 */

import { statSync, type Stats } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findCrateFile } from './find-crate-file.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';

vi.mock('node:fs');
vi.mock('../../utils/list-files-recursive.js');

const list = vi.mocked(listFilesRecursive);
const stat = vi.mocked(statSync);

function withSize(size: number): void {
  stat.mockReturnValue({ size } as unknown as Stats);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findCrateFile', () => {
  it('finds a nested, non-empty .crate by name-version', () => {
    const abs = '/reg/crates/demo/demo-1.0.0.crate';
    list.mockReturnValue([abs]);
    withSize(10);
    expect(findCrateFile('/reg', 'demo', '1.0.0')).toBe(abs);
  });

  it('returns null when the matching .crate is empty', () => {
    list.mockReturnValue(['/reg/crates/demo/demo-1.0.0.crate']);
    withSize(0);
    expect(findCrateFile('/reg', 'demo', '1.0.0')).toBeNull();
  });

  it('returns null when no .crate matches the name-version', () => {
    list.mockReturnValue(['/reg/crates/demo/demo-9.9.9.crate']);
    withSize(10);
    expect(findCrateFile('/reg', 'demo', '1.0.0')).toBeNull();
  });

  it('returns null for a missing registry root', () => {
    list.mockReturnValue([]);
    expect(findCrateFile('/reg/does-not-exist', 'demo', '1.0.0')).toBeNull();
  });
});

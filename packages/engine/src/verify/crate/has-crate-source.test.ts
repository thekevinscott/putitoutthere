/**
 * `hasCrateSource` — src/lib.rs || src/main.rs presence in an extracted
 * crate tree (#449). Isolated: `listFilesRecursive` is mocked so each branch
 * is driven by the returned file list, not a real temp tree. Real extraction
 * is covered by tests/integration/verify-crate.integration.test.ts and e2e.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasCrateSource } from './has-crate-source.js';
import { listFilesRecursive } from '../../utils/list-files-recursive.js';

vi.mock('../../utils/list-files-recursive.js');

const list = vi.mocked(listFilesRecursive);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasCrateSource', () => {
  it('is true when the tree has <prefix>/src/lib.rs', () => {
    list.mockReturnValue(['/x/demo-1.0.0/Cargo.toml', '/x/demo-1.0.0/src/lib.rs']);
    expect(hasCrateSource('/x')).toBe(true);
  });

  it('is true when the tree has <prefix>/src/main.rs', () => {
    list.mockReturnValue(['/x/demo-1.0.0/src/main.rs']);
    expect(hasCrateSource('/x')).toBe(true);
  });

  it('is false when only non-source files are present', () => {
    list.mockReturnValue(['/x/demo-1.0.0/Cargo.toml', '/x/demo-1.0.0/README.md']);
    expect(hasCrateSource('/x')).toBe(false);
  });

  it('does not match a stray main.rs outside a src/ dir', () => {
    list.mockReturnValue(['/x/demo-1.0.0/bin/main.rs']);
    expect(hasCrateSource('/x')).toBe(false);
  });
});

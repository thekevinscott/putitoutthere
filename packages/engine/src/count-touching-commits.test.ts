import { describe, expect, it } from 'vitest';

import type { Package } from './config.js';
import { countTouchingCommits } from './count-touching-commits.js';

function pkg(name: string, globs: string[], depends_on: string[] = []): Package {
  return { name, kind: 'crates', path: name, globs, depends_on, first_version: '0.1.0' } as Package;
}

const packages = [pkg('core', ['core/**']), pkg('py', ['py/**'], ['core']), pkg('docs', ['docs/**'])];

describe('countTouchingCommits', () => {
  it('counts commits that match the package globs', () => {
    expect(countTouchingCommits('py', packages, [['py/a.py'], ['docs/x.md'], ['py/b.py', 'docs/y.md']])).toBe(2);
  });

  it('counts a commit that changes only a dependency', () => {
    expect(countTouchingCommits('py', packages, [['core/lib.rs'], ['py/a.py']])).toBe(2);
  });

  it('ignores commits that touch only unrelated packages', () => {
    expect(countTouchingCommits('core', packages, [['py/a.py'], ['docs/x.md'], []])).toBe(0);
  });

  it('returns zero for no commits', () => {
    expect(countTouchingCommits('core', packages, [])).toBe(0);
  });
});

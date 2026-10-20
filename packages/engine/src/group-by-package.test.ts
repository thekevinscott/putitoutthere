import { describe, expect, it } from 'vitest';

import { groupByPackage } from './group-by-package.js';
import type { MatrixRow } from './plan.js';

function row(name: string, target: string): MatrixRow {
  return {
    name,
    kind: 'npm',
    version: '1.0.0',
    target,
    runs_on: 'ubuntu-latest',
    artifact_name: `${name}-${target}`,
    artifact_path: `${name}/dist`,
    path: name,
  };
}

describe('groupByPackage', () => {
  it('returns an empty map for no rows', () => {
    expect(groupByPackage([], [])).toEqual(new Map());
  });

  it('groups rows by package name in first-seen order, keeping row order within a package', () => {
    const a1 = row('a', 'main');
    const b1 = row('b', 'main');
    const a2 = row('a', 'linux-x64-gnu');
    const grouped = groupByPackage([a1, b1, a2], []);
    expect([...grouped.keys()]).toEqual(['a', 'b']);
    expect(grouped.get('a')).toStrictEqual([a1, a2]);
    expect(grouped.get('b')).toStrictEqual([b1]);
  });
});

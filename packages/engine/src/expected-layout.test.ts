import { describe, expect, it } from 'vitest';

import type { MatrixRow } from './completeness.js';
import { expectedLayout } from './expected-layout.js';

function row(over: Partial<MatrixRow>): MatrixRow {
  return { name: 'foo', kind: 'crates', version: '1.2.3', target: 'noarch', artifact_name: 'foo-crate', ...over };
}

describe('expectedLayout', () => {
  it('crates → {dir}/{name}-{version}.crate', () => {
    expect(expectedLayout(row({}))).toBe('artifacts/foo-crate/foo-1.2.3.crate');
  });

  it('pypi sdist → {dir}/{name}-{version}.tar.gz', () => {
    expect(
      expectedLayout(row({ kind: 'pypi', target: 'sdist', artifact_name: 'foo-sdist' })),
    ).toBe('artifacts/foo-sdist/foo-1.2.3.tar.gz');
  });

  it('pypi wheel → {dir}/{name}-{version}-<python-tags>.whl', () => {
    expect(
      expectedLayout(row({ kind: 'pypi', target: 'x86_64-unknown-linux-gnu', artifact_name: 'foo-wheel-linux' })),
    ).toBe('artifacts/foo-wheel-linux/foo-1.2.3-<python-tags>.whl');
  });

  it('npm main → {dir}/package.json', () => {
    expect(
      expectedLayout(row({ kind: 'npm', target: 'main', artifact_name: 'foo-main' })),
    ).toBe('artifacts/foo-main/package.json');
  });

  it('npm noarch → {dir}/package.json', () => {
    expect(
      expectedLayout(row({ kind: 'npm', target: 'noarch', artifact_name: 'foo-pkg' })),
    ).toBe('artifacts/foo-pkg/package.json');
  });

  it('npm platform → {dir}/<binary-or-bundle>', () => {
    expect(
      expectedLayout(row({ kind: 'npm', target: 'linux-x64-gnu', artifact_name: 'foo-linux-x64' })),
    ).toBe('artifacts/foo-linux-x64/<binary-or-bundle>');
  });
});

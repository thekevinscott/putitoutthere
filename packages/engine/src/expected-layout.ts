import type { MatrixRow } from './completeness.js';

/**
 * Human-facing hint for where a row's artifact is expected to live.
 * Lives alongside error messages so users don't have to cross-reference
 * plan.md §12.4 to figure out the naming contract.
 */
export function expectedLayout(row: MatrixRow): string {
  const dir = `artifacts/${row.artifact_name}`;
  switch (row.kind) {
    case 'crates':
      return `${dir}/${row.name}-${row.version}.crate`;
    case 'pypi':
      if (row.target === 'sdist') {
        return `${dir}/${row.name}-${row.version}.tar.gz`;
      }
      return `${dir}/${row.name}-${row.version}-<python-tags>.whl`;
    case 'npm':
      if (row.target === 'main' || row.target === 'noarch') {
        return `${dir}/package.json`;
      }
      return `${dir}/<binary-or-bundle>`;
  }
}

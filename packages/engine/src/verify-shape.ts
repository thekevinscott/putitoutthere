import type { MatrixRow } from './completeness.js';

export function verifyShape(row: MatrixRow, files: string[]): string | null {
  switch (row.kind) {
    case 'crates':
      return hasSuffix(files, '.crate')
        ? null
        : `no .crate file in ${row.artifact_name}/`;
    case 'pypi':
      if (row.target === 'sdist') {
        return hasSuffix(files, '.tar.gz')
          ? null
          : `no .tar.gz (sdist) in ${row.artifact_name}/`;
      }
      return hasSuffix(files, '.whl')
        ? null
        : `no .whl file in ${row.artifact_name}/`;
    case 'npm':
      // vanilla (noarch) and `main` must have package.json. Per-platform
      // rows need any binary/bundle artifact to be meaningful; since
      // napi + bundled-cli layouts vary, a non-empty directory is
      // enough.
      if (row.target === 'main' || row.target === 'noarch') {
        return hasFile(files, 'package.json')
          ? null
          : `no package.json in ${row.artifact_name}/`;
      }
      return null; // any non-empty file is acceptable for a platform package
  }
}

function hasSuffix(files: readonly string[], suffix: string): boolean {
  return files.some((f) => f.endsWith(suffix));
}

function hasFile(files: readonly string[], name: string): boolean {
  // Paths are normalized to `/` at the listing boundary (see `listFiles`),
  // so a single-separator trailing-name match is enough on every OS.
  return files.some((f) => f.endsWith(`/${name}`));
}

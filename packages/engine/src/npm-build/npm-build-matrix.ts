import { resolve } from 'node:path';

import { npmBuildPackage } from './npm-build-package.js';
import type { NpmBuildRow } from './types.js';

export async function npmBuildMatrix(matrix: string, boundary: string): Promise<void> {
  const versions = new Map<string, string>();
  for (const row of JSON.parse(matrix) as NpmBuildRow[]) {
    if (row.kind === 'npm' && !versions.has(row.path)) {versions.set(row.path, row.version);}
  }
  for (const [path, version] of versions) {
    process.stdout.write(`::group::npm install + build at ${path}\n`);
    try {
      await npmBuildPackage({ dir: resolve(boundary, path), boundary, target: 'main', build: '', version });
    } finally {
      process.stdout.write('::endgroup::\n');
    }
  }
}

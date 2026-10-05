import { resolve } from 'node:path';

import { npmBuildPackage } from './npm-build-package.js';

export async function npmBuildMatrix(matrix: string, boundary: string): Promise<void> {
  const versions = new Map<string, string>();
  for (const row of JSON.parse(matrix) as { kind: string; path: string; version: string }[]) {
    if (row.kind === 'npm' && !versions.has(row.path)) {versions.set(row.path, row.version);}
  }
  for (const [path, VERSION] of versions) {
    await npmBuildPackage(resolve(boundary, path), boundary, { TARGET: 'main', BUILD: '', VERSION });
  }
}

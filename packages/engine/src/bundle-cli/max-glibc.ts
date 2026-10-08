import { compareGlibc } from './compare-glibc.js';

export function maxGlibc(dynamicSymbols: string): string | undefined {
  const versions = dynamicSymbols.match(/GLIBC_\d+(\.\d+)+/g) ?? [];
  return versions.sort(compareGlibc).at(-1);
}

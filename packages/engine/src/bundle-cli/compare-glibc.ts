export function compareGlibc(a: string, b: string): number {
  const left = a.slice('GLIBC_'.length).split('.').map(Number);
  const right = b.slice('GLIBC_'.length).split('.').map(Number);
  const length = Math.max(left.length, right.length);
  return Array.from({ length }, (_, i) => (left[i] ?? 0) - (right[i] ?? 0)).find((diff) => diff !== 0) ?? 0;
}

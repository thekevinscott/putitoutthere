export function compareGlibc(a: string, b: string): number {
  const left = a.slice('GLIBC_'.length).split('.').map(Number);
  const right = b.slice('GLIBC_'.length).split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {return diff;}
  }
  return 0;
}

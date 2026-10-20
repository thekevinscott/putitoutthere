export function compareVersionTuples(a: readonly number[], b: readonly number[]): number {
  const diffs = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) - (b[i] ?? 0));
  const first = diffs.find((d) => d !== 0);
  return first === undefined ? 0 : Math.sign(first) || 1;
}

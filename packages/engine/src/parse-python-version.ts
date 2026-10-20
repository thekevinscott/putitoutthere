export function parsePythonVersion(s: string): number[] {
  return s.split('.').map((p) => Number.parseInt(p, 10));
}

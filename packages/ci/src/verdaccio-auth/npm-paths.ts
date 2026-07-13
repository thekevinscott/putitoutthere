/**
 * The sorted, de-duplicated list of npm package paths in the plan matrix.
 * Mirrors the bash `jq -r '.[] | select(.kind == "npm") | .path' | sort -u`
 * from the "Configure Verdaccio auth (first-publish)" step in
 * `e2e-fixture-job.yml`. Pure; unit-tested directly.
 */

interface MatrixRow {
  kind?: string;
  path?: string;
}

export function parseNpmPaths(matrix: string): string[] {
  const rows = JSON.parse(matrix) as MatrixRow[];
  const paths = rows.filter((row) => row.kind === 'npm').map((row) => row.path ?? 'null');
  return [...new Set(paths)].sort();
}

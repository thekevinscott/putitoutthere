/**
 * Shared types for `verify npm-tarball` (#443).
 *
 * The subcommand downloads each published npm tarball and asserts its
 * contents honor the declared shape — extracted from the two inline bash
 * blocks in `.github/workflows/e2e-fixture-job.yml`.
 */

export interface VerifyNpmTarballOptions {
  /** Source root; `<cwd>/<row.path>/package.json` supplies each row's `files[]`. */
  cwd: string;
  /** The plan matrix, as the JSON string the workflow already carries. */
  matrix: string;
  /**
   * Registry to read from. Present → tight packument-lag backoff and an
   * explicit `--registry` on `npm view` (the Verdaccio / first-publish
   * path). Absent → real npm with the generous CDN-propagation backoff.
   */
  registry?: string | undefined;
  /**
   * Per-triple mode: verify synthesized platform packages ship a
   * non-`package.json` file, instead of main/noarch `files[]` dirs.
   */
  perTriple?: boolean | undefined;
}

/** The matrix fields this command reads. Superset-compatible with `MatrixRow`. */
export interface TarballRow {
  name: string;
  kind: string;
  version: string;
  target: string;
  path: string;
}

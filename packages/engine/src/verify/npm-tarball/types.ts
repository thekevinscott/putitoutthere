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
   * Registry to read the per-version document from (the Verdaccio /
   * first-publish path sets it). Absent → `registry.npmjs.org`.
   */
  registry?: string | undefined;
  /**
   * Per-triple mode: verify synthesized platform packages ship a
   * non-`package.json` file, instead of main/noarch `files[]` dirs.
   */
  perTriple?: boolean | undefined;
}

/**
 * Outcome of one read of the per-version document (#716). `missing` is its
 * 404, `untarballed` a 200 whose document carries no `dist.tarball`, and
 * `unreadable` a read that never completed. `untarballed` is the only
 * failure a further read cannot change.
 */
export type NpmVersionDocRead =
  | { status: 'found'; tarball: string }
  | { status: 'missing' }
  | { status: 'untarballed' }
  | { status: 'unreadable'; detail: string };

/**
 * Where a tarball resolve landed. The failure already carries its own
 * explanation, so each caller annotates rather than re-diagnoses (#716).
 */
export type NpmTarballResolution =
  | { status: 'found'; url: string }
  | { status: 'failed'; reason: string };

/** The matrix fields this command reads. Superset-compatible with `MatrixRow`. */
export interface TarballRow {
  name: string;
  kind: string;
  version: string;
  target: string;
  path: string;
}

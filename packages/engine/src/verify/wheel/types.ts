/**
 * Option shape for `verify wheel` (#450).
 */

export interface VerifyWheelOptions {
  /** Working dir `--path` resolves against (default process.cwd()). */
  cwd: string;
  /** Package dir; the build artifact lives under `<path>/dist`. */
  path: string;
  /** The planned version the artifact must carry. */
  version: string;
  /**
   * The matrix row's target. `sdist` selects the sdist-filename check; any
   * other value (a wheel triple) selects the wheel-METADATA check.
   */
  target: string;
  /**
   * #610: the matrix row's `manylinux` baseline, when the package
   * configured one. The wheel filename must carry the matching
   * platform tag. Absent / empty / `auto`: no tag assertion.
   */
  manylinux?: string | undefined;
}

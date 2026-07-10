/**
 * Option shape for `verify bundle-cli` (#451).
 */

export interface VerifyBundleCliOptions {
  /** Working dir `--path` resolves against (default process.cwd()). */
  cwd: string;
  /** Package dir; the built wheel lives under `<path>/dist`. */
  path: string;
  /**
   * The `bundle_cli.stage_to` path the binary was staged into, relative to
   * the wheel root (a `[tool.maturin].python-source` prefix is subtracted).
   */
  stageTo: string;
  /** The `bundle_cli.bin` name (a `.exe` suffix is added on Windows targets). */
  bin: string;
  /**
   * The matrix row's target triple. A triple containing `windows` selects
   * the `.exe` binary suffix; any other value adds none.
   */
  target: string;
}

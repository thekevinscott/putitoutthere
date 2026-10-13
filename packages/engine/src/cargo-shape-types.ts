export type CratesShapeCode =
  | 'PIOT_CRATES_NAME_MISMATCH'
  | 'PIOT_CRATES_MISSING_BIN'
  | 'PIOT_CRATES_FEATURE_NOT_DECLARED'
  | 'PIOT_CRATES_WORKSPACE_VERSION_MISMATCH';

export interface CargoShapeFinding {
  package: string;
  cargoTomlPath: string;
  code: CratesShapeCode;
  detail: string;
}

export interface CargoShapeOptions {
  /** Used to resolve `bundle_cli.crate_path` (documented as relative
   *  to the repo root) and to bound the workspace-version walk.
   *  Defaults to `process.cwd()`. */
  cwd?: string;
}

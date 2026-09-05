/**
 * The shape of TestPyPI's release-metadata document once split into the
 * artifacts this gate downloads. Types only — the parsing lives in
 * `parse-release-files.ts`, the per-entry validation in `as-release-file.ts`.
 */

export interface ReleaseFile {
  filename: string;
  url: string;
}

export interface ReleaseFiles {
  wheels: readonly ReleaseFile[];
  sdists: readonly ReleaseFile[];
}

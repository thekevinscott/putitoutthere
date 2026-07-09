/**
 * Shared option shapes for the `release-github` command (#444).
 */

export interface ReleaseGithubOptions {
  /** The checked-out repo the tags live in and `gh` reads from. */
  cwd: string;
}

export interface GhOptions {
  cwd?: string | undefined;
}

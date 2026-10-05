/**
 * Decision core for the changelog-check gate (#452). I/O-free: given the
 * PR's commit log, the public-surface files it changed, and the files it
 * added, decide pass/fail and the lines to emit. A public-surface change
 * needs an added fragment in both `changelog.d/` and `migrations.d/` (#730).
 */

import { isFragment } from '../utils/is-fragment.js';
import { isMalformedFragment } from './is-malformed-fragment.js';

export interface ChangelogCheckInput {
  /** Raw `git log --format=%B <base>..<head>` output. */
  commitLog: string;
  /** Public-surface files changed (post-globset `git diff --name-only`). */
  surfaceFiles: readonly string[];
  /** Every file added `<base>..<head>` (`git diff --diff-filter=A`). */
  addedFiles: readonly string[];
}

export interface ChangelogCheckResult {
  exitCode: number;
  lines: readonly string[];
}

const FRAGMENT_DIRS = ['changelog.d', 'migrations.d'] as const;

// A fixed-prefix match plus an explicit length check, rather than a `.+`
// quantifier — the quantifier forms (`.+`, `.`, `.+$`) are indistinguishable
// under `RegExp.test()`, so they'd be unkillable equivalent mutants.
const SKIP_PREFIX = /^skip-changelog:/i;

export function decideChangelogCheck(input: ChangelogCheckInput): ChangelogCheckResult {
  const { commitLog, surfaceFiles, addedFiles } = input;

  const hasSkipTrailer = commitLog.split('\n').some((line) => {
    const prefix = SKIP_PREFIX.exec(line);
    return prefix !== null && line.length > prefix[0].length;
  });
  if (hasSkipTrailer) {
    return { exitCode: 0, lines: ["Found 'skip-changelog:' trailer; bypassing check."] };
  }

  const malformed = addedFiles
    .filter((path) => FRAGMENT_DIRS.some((dir) => isMalformedFragment(path, dir)))
    .map(
      (path) =>
        `::error file=${path}::fragment filenames must match YYYY-MM-DD-<slug>.md (UTC merge date; lowercase letters, digits, hyphens).`,
    );

  if (surfaceFiles.length === 0) {
    if (malformed.length > 0) {
      return { exitCode: 1, lines: malformed };
    }
    return { exitCode: 0, lines: ['No public-surface files changed; skipping.'] };
  }

  const lines: string[] = [...malformed, 'Public-surface files changed:', ...surfaceFiles.map((f) => `  - ${f}`), ''];

  const missing = FRAGMENT_DIRS.filter((dir) => !addedFiles.some((path) => isFragment(path, dir)));
  if (missing.length > 0) {
    lines.push(
      `::error::This PR changes public-surface files but did not add a fragment to: ${missing.map((dir) => `${dir}/`).join(' ')}`,
      "See AGENTS.md > 'Changelog and migration policy'.",
      "If the change has no consumer impact, add a commit with a 'skip-changelog:' trailer.",
    );
    return { exitCode: 1, lines };
  }

  if (malformed.length > 0) {
    return { exitCode: 1, lines };
  }

  lines.push('Changelog and migration fragments both added. OK.');
  return { exitCode: 0, lines };
}

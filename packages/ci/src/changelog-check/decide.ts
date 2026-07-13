/**
 * Decision core for the changelog-check gate (#452). I/O-free: given the
 * PR's commit log, the public-surface files it changed, and the full list
 * of changed files, decide pass/fail and the lines to emit. Extracted from
 * the inline bash in `.github/workflows/changelog-check.yml`; the decisions
 * and `::error::` text match it exactly (pinned in `decide.test.ts`).
 */

export interface ChangelogCheckInput {
  /** Raw `git log --format=%B <base>..<head>` output. */
  commitLog: string;
  /** Public-surface files changed (post-globset `git diff --name-only`). */
  surfaceFiles: readonly string[];
  /** Every file changed `<base>..<head>`. */
  changedFiles: readonly string[];
}

export interface ChangelogCheckResult {
  exitCode: number;
  lines: readonly string[];
}

// Mirrors the bash `grep -iqE '^skip-changelog:[[:space:]]*.+$'`: a line
// beginning `skip-changelog:` (any case) with a non-empty value. A
// fixed-prefix match plus an explicit length check, rather than a `.+`
// quantifier — the quantifier forms (`.+`, `.`, `.+$`) are indistinguishable
// under `RegExp.test()`, so they'd be unkillable equivalent mutants.
const SKIP_PREFIX = /^skip-changelog:/i;

export function decideChangelogCheck(input: ChangelogCheckInput): ChangelogCheckResult {
  const { commitLog, surfaceFiles, changedFiles } = input;

  const hasSkipTrailer = commitLog.split('\n').some((line) => {
    const prefix = SKIP_PREFIX.exec(line);
    return prefix !== null && line.length > prefix[0].length;
  });
  if (hasSkipTrailer) {
    return { exitCode: 0, lines: ["Found 'skip-changelog:' trailer; bypassing check."] };
  }

  if (surfaceFiles.length === 0) {
    return { exitCode: 0, lines: ['No public-surface files changed; skipping.'] };
  }

  const lines: string[] = ['Public-surface files changed:', ...surfaceFiles.map((f) => `  - ${f}`), ''];

  // grep -xF: whole-line, fixed-string match — `docs/CHANGELOG.md` does not count.
  let missing = '';
  if (!changedFiles.includes('CHANGELOG.md')) {missing += ' CHANGELOG.md';}
  if (!changedFiles.includes('MIGRATIONS.md')) {missing += ' MIGRATIONS.md';}

  if (missing !== '') {
    lines.push(
      `::error::This PR changes public-surface files but did not update:${missing}`,
      "See AGENTS.md > 'Changelog and migration policy'.",
      "If the change has no consumer impact, add a commit with a 'skip-changelog:' trailer.",
    );
    return { exitCode: 1, lines };
  }

  lines.push('CHANGELOG.md and MIGRATIONS.md both updated. OK.');
  return { exitCode: 0, lines };
}

/**
 * Decision core for the tdd-lint gate (#452). I/O-free: given the PR's
 * commit log and the `packages/engine/src/` files it changed, decide
 * pass/fail and the lines to emit. Extracted from the inline bash in
 * `.github/workflows/tdd-lint.yml` (the three-step Skip-Gates / src-vs-test
 * check, collapsed into one command); the decisions and every emitted line
 * — the `::notice`, the `::error` block, the skip/OK messages — match it
 * exactly (pinned in `decide.test.ts`).
 */

export interface TddLintInput {
  /** Raw `git log --format=%B <base>..<head>` output. */
  commitLog: string;
  /** Files changed under `packages/engine/src/` (`git diff --name-only`). */
  changedFiles: readonly string[];
}

export interface TddLintResult {
  exitCode: number;
  lines: readonly string[];
}

// Mirrors the bash `grep -E '^Skip-Gates:[[:space:]]*.+'`: a line beginning
// `Skip-Gates:` (case-sensitive) with a non-empty value. A fixed-prefix
// match plus an explicit length check, rather than a `.+` quantifier — the
// quantifier forms (`.+`, `.`, `.+$`) are indistinguishable under
// `RegExp.test()`, so they'd be unkillable equivalent mutants.
const SKIP_PREFIX = /^Skip-Gates:/;

export function decideTddLint(input: TddLintInput): TddLintResult {
  const { commitLog, changedFiles } = input;

  // `grep ... | head -1`: the first line carrying a non-empty Skip-Gates
  // trailer. The notice echoes the whole matched line, prefix included.
  const skipLine = commitLog.split('\n').find((line) => {
    const prefix = SKIP_PREFIX.exec(line);
    return prefix !== null && line.length > prefix[0].length;
  });
  if (skipLine !== undefined) {
    return { exitCode: 0, lines: [`::notice title=TDD lint bypassed::${skipLine}`] };
  }

  if (changedFiles.length === 0) {
    return { exitCode: 0, lines: ['No src/ changes in this PR -- skipping TDD lint.'] };
  }

  // A PR is test-bearing if the diff touches any *.test.ts file. Past the
  // empty check, "no test files" already implies at least one non-test file
  // changed, so the bash's `[ -n non_test ] && [ -z tests ]` reduces to
  // `[ -z tests ]` — and every changed file is then a non-test file, so the
  // "PR modifies:" list is exactly `changedFiles`. Collapsing the two
  // conditions removes a coupled boundary that would otherwise be an
  // unkillable equivalent mutant.
  const testChanged = changedFiles.filter((f) => f.endsWith('.test.ts'));

  if (testChanged.length === 0) {
    return {
      exitCode: 1,
      lines: [
        '::error::src/ changes detected without matching *.test.ts changes.',
        'PR modifies:',
        ...changedFiles.map((f) => `  ${f}`),
        '',
        'Write a failing test first (red) then implement it (green).',
        'See plan.md §23.7. Or add a `Skip-Gates: <reason>` trailer to any commit in this PR to bypass (notes/gates.md).',
      ],
    };
  }

  return { exitCode: 0, lines: ['OK: src/ changes include *.test.ts updates.'] };
}

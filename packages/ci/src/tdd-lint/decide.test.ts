/**
 * Decision matrix for the tdd-lint gate (#452), extracted from the inline
 * bash in `.github/workflows/tdd-lint.yml`. Pins the exact pass/fail
 * decisions and every emitted line the bash produced (the `::notice` skip
 * annotation, the `::error` block, and the skip/OK messages), so the
 * TypeScript reimplementation is provably equivalent. Pure — no I/O — so
 * every branch is driven by plain inputs. Assertions are exact (`toEqual`
 * on the full line list) so a dropped or altered message is caught.
 */

import { describe, expect, it } from 'vitest';

import { decideTddLint } from './decide.js';

// A single non-test src change: forces a determinate non-skip outcome
// (the error branch) so skip-trailer negatives can assert exitCode 1.
const oneSrcChange = { changedFiles: ['packages/engine/src/plan.ts'] };

describe('decideTddLint: Skip-Gates trailer', () => {
  it('bypasses with the exact notice line, echoing the whole matched line', () => {
    const r = decideTddLint({ commitLog: 'feat: x\n\nSkip-Gates: flaky infra\n', changedFiles: ['packages/engine/src/plan.ts'] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['::notice title=TDD lint bypassed::Skip-Gates: flaky infra']);
  });

  it('matches a value with no space after the colon', () => {
    const r = decideTddLint({ ...oneSrcChange, commitLog: 'Skip-Gates:x\n' });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['::notice title=TDD lint bypassed::Skip-Gates:x']);
  });

  it('uses the first matching trailer (head -1)', () => {
    const r = decideTddLint({ ...oneSrcChange, commitLog: 'Skip-Gates: first\nSkip-Gates: second\n' });
    expect(r.lines).toEqual(['::notice title=TDD lint bypassed::Skip-Gates: first']);
  });

  it('is case-sensitive: lowercase skip-gates does NOT bypass', () => {
    const r = decideTddLint({ ...oneSrcChange, commitLog: 'skip-gates: x\n' });
    expect(r.exitCode).toBe(1);
    expect(r.lines[0]).toBe('::error::src/ changes detected without matching *.test.ts changes.');
  });

  it('does NOT bypass when the trailer is not at the start of a line', () => {
    const r = decideTddLint({ ...oneSrcChange, commitLog: 'xSkip-Gates: y\n' });
    expect(r.exitCode).toBe(1);
    expect(r.lines[0]).toBe('::error::src/ changes detected without matching *.test.ts changes.');
  });

  it('does NOT bypass when the trailer has no value', () => {
    const r = decideTddLint({ ...oneSrcChange, commitLog: 'Skip-Gates:\n' });
    expect(r.exitCode).toBe(1);
    expect(r.lines[0]).toBe('::error::src/ changes detected without matching *.test.ts changes.');
  });

  it('does NOT bypass an unrelated commit log', () => {
    const r = decideTddLint({ ...oneSrcChange, commitLog: 'chore: Skip-Gates someday\n' });
    expect(r.exitCode).toBe(1);
    expect(r.lines[0]).toBe('::error::src/ changes detected without matching *.test.ts changes.');
  });
});

describe('decideTddLint: no src changes', () => {
  it('passes with the exact line when nothing under engine/src changed', () => {
    const r = decideTddLint({ commitLog: 'docs: x\n', changedFiles: [] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['No src/ changes in this PR -- skipping TDD lint.']);
  });
});

describe('decideTddLint: src changes must carry tests', () => {
  it('fails with the exact block, listing every changed file, when no test changed', () => {
    const r = decideTddLint({
      commitLog: 'feat: x\n',
      changedFiles: ['packages/engine/src/plan.ts', 'packages/engine/src/config.ts'],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      '::error::src/ changes detected without matching *.test.ts changes.',
      'PR modifies:',
      '  packages/engine/src/plan.ts',
      '  packages/engine/src/config.ts',
      '',
      'Write a failing test first (red) then implement it (green).',
      'See plan.md §23.7. Or add a `Skip-Gates: <reason>` trailer to any commit in this PR to bypass (notes/gates.md).',
    ]);
  });

  it('fails for a single non-test change (kills the empty-vs-one boundary)', () => {
    const r = decideTddLint({ commitLog: 'feat: x\n', changedFiles: ['packages/engine/src/plan.ts'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      '::error::src/ changes detected without matching *.test.ts changes.',
      'PR modifies:',
      '  packages/engine/src/plan.ts',
      '',
      'Write a failing test first (red) then implement it (green).',
      'See plan.md §23.7. Or add a `Skip-Gates: <reason>` trailer to any commit in this PR to bypass (notes/gates.md).',
    ]);
  });

  it('passes with the exact line when a src change is accompanied by a test change', () => {
    const r = decideTddLint({
      commitLog: 'feat: x\n',
      changedFiles: ['packages/engine/src/plan.ts', 'packages/engine/src/plan.test.ts'],
    });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['OK: src/ changes include *.test.ts updates.']);
  });

  it('passes when only a test file changed (testChanged.length is exactly 1)', () => {
    const r = decideTddLint({ commitLog: 'test: x\n', changedFiles: ['packages/engine/src/plan.test.ts'] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['OK: src/ changes include *.test.ts updates.']);
  });

  it('matches *.test.ts only as a suffix, not a substring (a .test.ts.snap is not a test)', () => {
    const r = decideTddLint({ commitLog: 'feat: x\n', changedFiles: ['packages/engine/src/plan.test.ts.snap'] });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      '::error::src/ changes detected without matching *.test.ts changes.',
      'PR modifies:',
      '  packages/engine/src/plan.test.ts.snap',
      '',
      'Write a failing test first (red) then implement it (green).',
      'See plan.md §23.7. Or add a `Skip-Gates: <reason>` trailer to any commit in this PR to bypass (notes/gates.md).',
    ]);
  });
});

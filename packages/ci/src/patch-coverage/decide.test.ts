/**
 * Decision matrix for the patch-coverage gate (#468), extracted from
 * `.github/workflows/patch-coverage.mjs`. Pins the exact pass/fail decisions,
 * the exact stdout (`out`) / stderr (`err`) lines, and the exact exit codes
 * the `.mjs` produced, so the TypeScript reimplementation is provably
 * equivalent. Pure — the coverage lookup is injected as `coverageFor`. Exact
 * assertions (`toEqual` on the full line lists) so a dropped or altered
 * message is caught.
 */

import { describe, expect, it } from 'vitest';

import { decidePatchCoverage } from './decide.js';
import type { CoveredLines, PatchCoverageInput } from './patch-coverage-types.js';

const cov = (covered: number[], uncovered: number[]): CoveredLines => ({
  covered: new Set(covered),
  uncovered: new Set(uncovered),
});

const decide = (input: PatchCoverageInput) => decidePatchCoverage(input);

describe('decidePatchCoverage: no additions', () => {
  it('passes with the exact stdout line and never consults coverage', () => {
    let called = false;
    const r = decide({
      addedByFile: [],
      coverageFor: () => {
        called = true;
        return null;
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual(['patch-coverage: no src/**/*.ts additions in this PR; passing.']);
    expect(r.err).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('decidePatchCoverage: clean pass', () => {
  it('passes with the exact success line when every added line is covered', () => {
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 5, text: 'const x = 1;' }] }],
      coverageFor: () => cov([5], []),
    });
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual(['patch-coverage: every added src/ line is covered, no escape hatches. ✓']);
    expect(r.err).toEqual([]);
  });

  it('skips blank, comment, and pure-punctuation added lines without demanding coverage', () => {
    const r = decide({
      addedByFile: [
        {
          file: 'packages/engine/src/foo.ts',
          added: [
            { line: 5, text: '' },
            { line: 6, text: '  // a comment' },
            { line: 7, text: '  /* block */' },
            { line: 8, text: '   * jsdoc' },
            { line: 9, text: '});' },
          ],
        },
      ],
      coverageFor: () => cov([], [5, 6, 7, 8, 9]),
    });
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual(['patch-coverage: every added src/ line is covered, no escape hatches. ✓']);
  });

  it('passes a line that appears in neither the covered nor the uncovered set', () => {
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 42, text: 'const x = 1;' }] }],
      coverageFor: () => cov([], []),
    });
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual(['patch-coverage: every added src/ line is covered, no escape hatches. ✓']);
  });
});

describe('decidePatchCoverage: uncovered violation', () => {
  it('fails with the exact header block and ::error line for an uncovered added line', () => {
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 12, text: '  const x = 1;' }] }],
      coverageFor: () => cov([], [12]),
    });
    expect(r.exitCode).toBe(1);
    expect(r.out).toEqual([]);
    expect(r.err).toEqual([
      'patch-coverage: violations found.',
      '',
      'Strict 100% on new src/ code; no `/* v8 ignore */` escape hatches.',
      'Add a unit test that exercises each new line listed below, or restructure',
      'the new code so it sits on an already-tested path.',
      '',
      '::error file=packages/engine/src/foo.ts,line=12::patch-coverage [uncovered] added line not exercised by unit tests: const x = 1;',
      '',
      '1 violation(s).',
    ]);
  });

  it('reports every uncovered line as a file has no coverage data when coverageFor is null', () => {
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 3, text: 'const x = 1;' }] }],
      coverageFor: () => null,
    });
    expect(r.exitCode).toBe(1);
    expect(r.err).toEqual([
      'patch-coverage: violations found.',
      '',
      'Strict 100% on new src/ code; no `/* v8 ignore */` escape hatches.',
      'Add a unit test that exercises each new line listed below, or restructure',
      'the new code so it sits on an already-tested path.',
      '',
      '::error file=packages/engine/src/foo.ts,line=3::patch-coverage [uncovered] file has no coverage data (no test ever loaded it)',
      '',
      '1 violation(s).',
    ]);
  });

  it('does not flag an uncovered-set line that is also in the covered set', () => {
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 8, text: 'const x = 1;' }] }],
      coverageFor: () => cov([8], [8]),
    });
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual(['patch-coverage: every added src/ line is covered, no escape hatches. ✓']);
  });
});

describe('decidePatchCoverage: escape-hatch violation', () => {
  it('rejects a newly introduced v8 ignore marker with the exact ::error line', () => {
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 20, text: '  /* v8 ignore next */' }] }],
      coverageFor: () => cov([20], []),
    });
    expect(r.exitCode).toBe(1);
    expect(r.err).toEqual([
      'patch-coverage: violations found.',
      '',
      'Strict 100% on new src/ code; no `/* v8 ignore */` escape hatches.',
      'Add a unit test that exercises each new line listed below, or restructure',
      'the new code so it sits on an already-tested path.',
      '',
      '::error file=packages/engine/src/foo.ts,line=20::patch-coverage [escape-hatch] new ignore marker introduced: /* v8 ignore next */',
      '',
      '1 violation(s).',
    ]);
  });

  it('checks the escape hatch before the covered/uncovered classification', () => {
    // Even a line the coverage data marks covered is a violation if it adds a
    // marker — the hatch check runs first and uses the untrimmed text.
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 1, text: '/* istanbul ignore next */' }] }],
      coverageFor: () => cov([1], []),
    });
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain(
      '::error file=packages/engine/src/foo.ts,line=1::patch-coverage [escape-hatch] new ignore marker introduced: /* istanbul ignore next */',
    );
  });
});

describe('decidePatchCoverage: multiple violations', () => {
  it('accumulates violations across files in order and pluralises the count', () => {
    const r = decide({
      addedByFile: [
        { file: 'packages/engine/src/a.ts', added: [{ line: 1, text: 'const a = 1;' }] },
        { file: 'packages/engine/src/b.ts', added: [{ line: 2, text: '  /* c8 ignore next */' }] },
      ],
      coverageFor: (file) => (file === 'packages/engine/src/a.ts' ? cov([], [1]) : cov([2], [])),
    });
    expect(r.exitCode).toBe(1);
    expect(r.err).toEqual([
      'patch-coverage: violations found.',
      '',
      'Strict 100% on new src/ code; no `/* v8 ignore */` escape hatches.',
      'Add a unit test that exercises each new line listed below, or restructure',
      'the new code so it sits on an already-tested path.',
      '',
      '::error file=packages/engine/src/a.ts,line=1::patch-coverage [uncovered] added line not exercised by unit tests: const a = 1;',
      '::error file=packages/engine/src/b.ts,line=2::patch-coverage [escape-hatch] new ignore marker introduced: /* c8 ignore next */',
      '',
      '2 violation(s).',
    ]);
  });
});

describe('decidePatchCoverage: reasoned ignore markers are permitted', () => {
  // Gate-4 (epic #474) needs to mark genuinely-unreachable engine branches to
  // reach the unit-coverage 100% floor, but the strict-100% patch-coverage gate
  // used to reject *every* newly-introduced ignore marker. The policy now
  // distinguishes a documented marker (`/* v8 ignore next -- <reason> */`) —
  // permitted — from a bare escape hatch — still rejected. The required reason
  // keeps the "no lazy escape hatches" intent: a marker must justify itself.

  it('does NOT flag a newly introduced v8 ignore marker that carries a `-- reason`', () => {
    const r = decide({
      addedByFile: [
        {
          file: 'packages/engine/src/foo.ts',
          added: [
            { line: 25, text: '  /* v8 ignore next -- unreachable: Zod defaults depends_on to [] */' },
          ],
        },
      ],
      coverageFor: () => cov([25], []),
    });
    expect(r.exitCode).toBe(0);
    expect(r.out).toEqual(['patch-coverage: every added src/ line is covered, no escape hatches. ✓']);
  });

  it('still rejects a bare marker with no reason', () => {
    const r = decide({
      addedByFile: [{ file: 'packages/engine/src/foo.ts', added: [{ line: 26, text: '  /* v8 ignore next */' }] }],
      coverageFor: () => cov([26], []),
    });
    expect(r.exitCode).toBe(1);
    expect(r.err).toContain(
      '::error file=packages/engine/src/foo.ts,line=26::patch-coverage [escape-hatch] new ignore marker introduced: /* v8 ignore next */',
    );
  });
});

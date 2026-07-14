/**
 * Pins how the patch-coverage gate (#468) turns one file's istanbul-format
 * coverage record (the v8 reporter's `{ s, statementMap }`) into the sets of
 * covered / uncovered line numbers. Reproduces the `.mjs`'s `coveredLines`:
 *   - a statement spans start.line..end.line inclusive;
 *   - hits > 0 marks every spanned line covered, otherwise uncovered;
 *   - a line touched by both a covered and an uncovered statement is covered
 *     (the covered set wins — `uncovered.delete(l)`);
 *   - a missing file record yields null.
 * Pure; exact assertions on the sorted membership.
 */

import { describe, expect, it } from 'vitest';

import { coveredLines } from './covered-lines.js';
import type { FileCoverage } from './patch-coverage-types.js';

const sorted = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);

describe('coveredLines', () => {
  it('returns null when there is no record for the file', () => {
    expect(coveredLines(undefined)).toBeNull();
  });

  it('marks a hit single-line statement as covered', () => {
    const data: FileCoverage = {
      s: { '0': 3 },
      statementMap: { '0': { start: { line: 5 }, end: { line: 5 } } },
    };
    const result = coveredLines(data);
    expect(result).not.toBeNull();
    expect(sorted(result!.covered)).toEqual([5]);
    expect(sorted(result!.uncovered)).toEqual([]);
  });

  it('marks a zero-hit single-line statement as uncovered', () => {
    const data: FileCoverage = {
      s: { '0': 0 },
      statementMap: { '0': { start: { line: 9 }, end: { line: 9 } } },
    };
    const result = coveredLines(data);
    expect(sorted(result!.covered)).toEqual([]);
    expect(sorted(result!.uncovered)).toEqual([9]);
  });

  it('spans every line of a multi-line statement inclusively', () => {
    const data: FileCoverage = {
      s: { '0': 1 },
      statementMap: { '0': { start: { line: 4 }, end: { line: 7 } } },
    };
    const result = coveredLines(data);
    expect(sorted(result!.covered)).toEqual([4, 5, 6, 7]);
    expect(sorted(result!.uncovered)).toEqual([]);
  });

  it('lets a covered statement win over an uncovered one sharing a line', () => {
    const data: FileCoverage = {
      s: { '0': 0, '1': 2 },
      statementMap: {
        '0': { start: { line: 10 }, end: { line: 10 } },
        '1': { start: { line: 10 }, end: { line: 10 } },
      },
    };
    const result = coveredLines(data);
    expect(sorted(result!.covered)).toEqual([10]);
    expect(sorted(result!.uncovered)).toEqual([]);
  });

  it('keeps distinct covered and uncovered lines separate', () => {
    const data: FileCoverage = {
      s: { '0': 1, '1': 0 },
      statementMap: {
        '0': { start: { line: 1 }, end: { line: 1 } },
        '1': { start: { line: 2 }, end: { line: 2 } },
      },
    };
    const result = coveredLines(data);
    expect(sorted(result!.covered)).toEqual([1]);
    expect(sorted(result!.uncovered)).toEqual([2]);
  });

  it('skips a statement id present in s but absent from statementMap', () => {
    const data: FileCoverage = {
      s: { '0': 1, '1': 1 },
      statementMap: { '0': { start: { line: 3 }, end: { line: 3 } } },
    };
    const result = coveredLines(data);
    expect(sorted(result!.covered)).toEqual([3]);
    expect(sorted(result!.uncovered)).toEqual([]);
  });

  it('returns empty sets for a record with no statements', () => {
    const data: FileCoverage = { s: {}, statementMap: {} };
    const result = coveredLines(data);
    expect(sorted(result!.covered)).toEqual([]);
    expect(sorted(result!.uncovered)).toEqual([]);
  });
});

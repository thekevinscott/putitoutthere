/**
 * `reconcileSkipWarnings` — one annotation per undecidable row (#694).
 *
 * The contract under test is not the wording, it is that an unreadable
 * registry becomes something a human will see. `pypi-tag` reported
 * `{"ok":true,"dryRun":false,"actions":[]}` for a package it never
 * tagged; "no action" and "no idea" printed identically, so the missing
 * tag was found by a human noticing it weeks later. These assertions pin
 * the three properties that make the difference observable: the
 * `::warning::` prefix (without it GitHub renders a log line nobody
 * scrolls to, not an annotation), the package name (a repo publishes to
 * several registries — "a registry failed" is not actionable), and
 * one-line-per-row (an annotation that swallows its siblings loses every
 * package but the first).
 */

import { describe, expect, it } from 'vitest';

import { reconcileSkipWarnings } from './reconcile-skip-warnings.js';

describe('reconcileSkipWarnings', () => {
  it('says nothing when every row was decided', () => {
    expect(reconcileSkipWarnings([])).toEqual([]);
  });

  it('annotates the registry it could not read, naming the package', () => {
    const lines = reconcileSkipWarnings([
      { package: 'mycrate-py', kind: 'pypi', reason: 'registry-unreachable' },
    ]);

    expect(lines).toHaveLength(1);
    // `::warning::` is the load-bearing prefix: it is what promotes the
    // line from log noise to an annotation on the run and the job summary.
    expect(lines[0]).toMatch(/^::warning::/);
    expect(lines[0]).toContain('mycrate-py');
    expect(lines[0]).toContain('pypi');
    // The two facts a reader needs: a tag may be missing, and re-running
    // is the fix (the skip is not a verdict about the package).
    expect(lines[0]).toContain('tag may be missing');
    expect(lines[0]).toMatch(/[Rr]e-run/);
  });

  it('emits one line per skipped row, in order, without merging them', () => {
    const lines = reconcileSkipWarnings([
      { package: 'core-rust', kind: 'crates', reason: 'registry-unreachable' },
      { package: 'core-py', kind: 'pypi', reason: 'registry-unreachable' },
      { package: 'core-js', kind: 'npm', reason: 'registry-unreachable' },
    ]);

    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.startsWith('::warning::'))).toEqual([true, true, true]);
    // Each line carries exactly its own package — a renderer that
    // concatenated or reused the first row would still produce 3 lines.
    expect(lines[0]).toContain('core-rust');
    expect(lines[0]).toContain('crates');
    expect(lines[1]).toContain('core-py');
    expect(lines[2]).toContain('core-js');
    expect(lines[0]).not.toContain('core-py');
    expect(lines[2]).not.toContain('core-rust');
  });

  it('keeps every annotation on a single line', () => {
    // The caller appends exactly one `\n` per entry. An embedded newline
    // would split the annotation and GitHub would drop the remainder.
    const lines = reconcileSkipWarnings([
      { package: 'core-py', kind: 'pypi', reason: 'registry-unreachable' },
      { package: 'core-js', kind: 'npm', reason: 'registry-unreachable' },
    ]);

    for (const line of lines) {
      expect(line).not.toContain('\n');
    }
  });
});

/**
 * Decision matrix for the actionlint id-token gate (#452), extracted from the
 * `Assert PR-time path has no id-token permission` step in
 * `.github/workflows/actionlint.yml`. Pins the exact pass/fail decisions and
 * every emitted line (the `grep -n` `<lineNumber>:<line>` echoes and the
 * `::error file=…::` message), so the TypeScript reimplementation is provably
 * equivalent to the grep it replaces. Pure — no I/O. Assertions are exact
 * (`toEqual` on the full line list) so a dropped or altered message is caught.
 */

import { describe, expect, it } from 'vitest';

import { decideActionlintIdToken } from './decide.js';

const err = (path: string): string =>
  `::error file=${path}::id-token: write is forbidden on the PR-time path (issues #272, #317)`;

// Run the decision over a single file named `f.yml`.
const check = (content: string) => decideActionlintIdToken({ files: [{ path: 'f.yml', content }] });

describe('decideActionlintIdToken: what counts as an id-token: write declaration', () => {
  it('flags a standard indented `id-token: write`, echoing the line with its number', () => {
    const r = check('  id-token: write');
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual(['1:  id-token: write', err('f.yml')]);
  });

  it('does NOT flag `id-token: write` at column 0 (the leading-whitespace requirement)', () => {
    expect(check('id-token: write')).toEqual({ exitCode: 0, lines: [] });
  });

  it('does NOT flag an indented comment that merely mentions id-token: write', () => {
    expect(check('  # id-token: write is forbidden here')).toEqual({ exitCode: 0, lines: [] });
  });

  it('does NOT flag an indented bare colon (guards the key literal against emptying)', () => {
    expect(check('  : write')).toEqual({ exitCode: 0, lines: [] });
  });

  it('does NOT flag a different, same-length key that grants write (the key literal gates, not its length)', () => {
    // `contents` is 8 chars, exactly like `id-token`, so slicing the key
    // length off `  contents: write` leaves `: write` — a match on
    // everything-but-the-key. The explicit `startsWith(KEY)` check must
    // still reject it; drop that guard and this line false-flags.
    expect(check('  contents: write')).toEqual({ exitCode: 0, lines: [] });
  });

  it('flags a space before the colon (`id-token : write`)', () => {
    const r = check('  id-token : write');
    expect(r.lines).toEqual(['1:  id-token : write', err('f.yml')]);
  });

  it('does NOT flag `id-token=write` (a colon is required)', () => {
    expect(check('  id-token=write')).toEqual({ exitCode: 0, lines: [] });
  });

  it('flags `id-token:write` with no space after the colon', () => {
    const r = check('  id-token:write');
    expect(r.lines).toEqual(['1:  id-token:write', err('f.yml')]);
  });

  it('flags `id-token:  write` with extra spaces after the colon', () => {
    const r = check('  id-token:  write');
    expect(r.lines).toEqual(['1:  id-token:  write', err('f.yml')]);
  });

  it('does NOT flag a different value (`id-token: read`)', () => {
    expect(check('  id-token: read')).toEqual({ exitCode: 0, lines: [] });
  });

  it('flags a value that merely starts with write (unanchored, like grep)', () => {
    const r = check('  id-token: write-token');
    expect(r.lines).toEqual(['1:  id-token: write-token', err('f.yml')]);
  });

  it('flags `id-token: write` followed by a trailing comment', () => {
    const r = check('  id-token: write # needed for OIDC');
    expect(r.lines).toEqual(['1:  id-token: write # needed for OIDC', err('f.yml')]);
  });
});

describe('decideActionlintIdToken: line numbering and multi-file orchestration', () => {
  it('passes with no output when every file is clean', () => {
    const r = decideActionlintIdToken({
      files: [
        { path: '.github/workflows/build.yml', content: 'permissions:\n  contents: read\n' },
        { path: '.github/workflows/_matrix.yml', content: 'permissions:\n  contents: read\n' },
        { path: '.github/workflows/check.yml', content: 'jobs:\n  check:\n    runs-on: ubuntu-latest\n' },
      ],
    });
    expect(r).toEqual({ exitCode: 0, lines: [] });
  });

  it('reports the 1-based line number of a violation deeper in the file', () => {
    const r = check('permissions:\n  contents: read\n  id-token: write\n');
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual(['3:  id-token: write', err('f.yml')]);
  });

  it('reports a violation on the first line as `1:`', () => {
    const r = check('  id-token: write\njobs: {}\n');
    expect(r.lines).toEqual(['1:  id-token: write', err('f.yml')]);
  });

  it('echoes every matching line in a file, then one ::error for the file', () => {
    const r = check('  id-token: write\n  id-token: write\n');
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      '1:  id-token: write',
      '2:  id-token: write',
      err('f.yml'),
    ]);
  });

  it('names each violating file in order, with its own grep echo and ::error', () => {
    const r = decideActionlintIdToken({
      files: [
        { path: '.github/workflows/build.yml', content: '  id-token: write' },
        { path: '.github/workflows/_matrix.yml', content: 'permissions:\n  contents: read' },
        { path: '.github/workflows/check.yml', content: '  id-token: write' },
      ],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      '1:  id-token: write',
      err('.github/workflows/build.yml'),
      '1:  id-token: write',
      err('.github/workflows/check.yml'),
    ]);
  });
});

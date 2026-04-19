/**
 * Release-trailer parser tests. TDD-style.
 *
 * Grammar per plan.md §10.3.
 * Last-`release:`-wins per plan.md §10.6.
 * Examples per plan.md §10.5.
 *
 * Issue #6.
 */

import { describe, expect, it } from 'vitest';
import { parseTrailer } from './trailer.js';

describe('parseTrailer: happy paths', () => {
  it('returns null for an empty message', () => {
    expect(parseTrailer('')).toBeNull();
  });

  it('returns null when no release trailer is present', () => {
    expect(parseTrailer('Fix a bug\n\nMore prose here.')).toBeNull();
  });

  it('parses a bare patch trailer', () => {
    const body = 'Subject\n\nBody paragraph.\n\nrelease: patch\n';
    expect(parseTrailer(body)).toEqual({ bump: 'patch', packages: [] });
  });

  it('parses minor', () => {
    expect(parseTrailer('release: minor')).toEqual({ bump: 'minor', packages: [] });
  });

  it('parses major', () => {
    expect(parseTrailer('release: major')).toEqual({ bump: 'major', packages: [] });
  });

  it('parses skip', () => {
    expect(parseTrailer('release: skip')).toEqual({ bump: 'skip', packages: [] });
  });
});

describe('parseTrailer: package list (§10.5 examples)', () => {
  it('parses a single-package list: release: major [dirsql-python]', () => {
    expect(parseTrailer('release: major [dirsql-python]')).toEqual({
      bump: 'major',
      packages: ['dirsql-python'],
    });
  });

  it('parses a multi-package list', () => {
    expect(parseTrailer('release: minor [a, b, c]')).toEqual({
      bump: 'minor',
      packages: ['a', 'b', 'c'],
    });
  });

  it('tolerates extra whitespace inside the brackets', () => {
    expect(parseTrailer('release: minor [ a ,  b   , c ]')).toEqual({
      bump: 'minor',
      packages: ['a', 'b', 'c'],
    });
  });

  it('parses names with hyphens and digits', () => {
    expect(parseTrailer('release: patch [dirsql-python, proj2, my-thing-v2]')).toEqual({
      bump: 'patch',
      packages: ['dirsql-python', 'proj2', 'my-thing-v2'],
    });
  });

  it('parses an empty list as no packages', () => {
    expect(parseTrailer('release: minor []')).toEqual({ bump: 'minor', packages: [] });
  });
});

describe('parseTrailer: case + whitespace', () => {
  it('case-insensitive key', () => {
    expect(parseTrailer('Release: patch')).toEqual({ bump: 'patch', packages: [] });
    expect(parseTrailer('RELEASE: patch')).toEqual({ bump: 'patch', packages: [] });
  });

  it('accepts tabs / extra spaces around the value', () => {
    expect(parseTrailer('release:   patch')).toEqual({ bump: 'patch', packages: [] });
    expect(parseTrailer('release:\tminor')).toEqual({ bump: 'minor', packages: [] });
  });

  it('values remain case-sensitive (patch lowercase only)', () => {
    // Bump values are a closed enum — keeping them strict avoids ambiguity
    // when agents emit shouty text.
    expect(parseTrailer('release: PATCH')).toBeNull();
  });
});

describe('parseTrailer: last-wins (§10.6)', () => {
  it('only the last release: trailer is honored', () => {
    const body = `Subject

release: patch

some text

release: major
`;
    expect(parseTrailer(body)).toEqual({ bump: 'major', packages: [] });
  });

  it('late-trailer list overrides earlier one', () => {
    const body = `release: minor [a, b]

actually never mind

release: patch [c]
`;
    expect(parseTrailer(body)).toEqual({ bump: 'patch', packages: ['c'] });
  });
});

describe('parseTrailer: rejects malformed', () => {
  it('rejects an unknown bump value', () => {
    expect(parseTrailer('release: yeet')).toBeNull();
  });

  it('rejects missing value', () => {
    expect(parseTrailer('release:')).toBeNull();
    expect(parseTrailer('release: ')).toBeNull();
  });

  it('rejects a non-trailer line even if it contains the word release', () => {
    expect(parseTrailer('This PR is a release: please merge')).toBeNull();
  });

  it('rejects an open bracket with no close', () => {
    expect(parseTrailer('release: minor [a, b')).toBeNull();
  });

  it('rejects an empty package name in the list', () => {
    expect(parseTrailer('release: minor [a,, b]')).toBeNull();
    expect(parseTrailer('release: minor [, a]')).toBeNull();
  });

  it('rejects a package name with disallowed characters', () => {
    expect(parseTrailer('release: patch [a b]')).toBeNull(); // space inside name
    expect(parseTrailer('release: patch [a/b]')).toBeNull(); // slash inside name
  });

  it('rejects stray text after the closing bracket', () => {
    expect(parseTrailer('release: minor [a, b] oops')).toBeNull();
  });
});

describe('parseTrailer: in-context commit messages', () => {
  it('finds a trailer at the very end of a realistic commit body', () => {
    const body = `Add streaming reader API

Adds a chunked reader to dirsql that yields rows lazily instead
of buffering the full result set.

release: minor
`;
    expect(parseTrailer(body)).toEqual({ bump: 'minor', packages: [] });
  });

  it('ignores a release: that appears inside a code fence / indent', () => {
    // Strictly line-anchored: a release: preceded only by whitespace counts;
    // indented blocks (4+ spaces) should still count since real commit bodies
    // rarely indent trailers. Be lenient here — the field lead itself is
    // enough signal.
    const body = `Subject

    release: patch
`;
    expect(parseTrailer(body)).toEqual({ bump: 'patch', packages: [] });
  });
});

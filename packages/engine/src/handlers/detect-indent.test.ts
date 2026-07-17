import { describe, expect, it } from 'vitest';

import { detectIndent } from './detect-indent.js';

describe('detectIndent', () => {
  it('detects a 2-space indent', () => {
    expect(detectIndent('{\n  "name": "x"\n}\n')).toBe(2);
  });

  it('detects a 4-space indent', () => {
    expect(detectIndent('{\n    "name": "x"\n}\n')).toBe(4);
  });

  it('detects a tab indent', () => {
    expect(detectIndent('{\n\t"name": "x"\n}\n')).toBe('\t');
  });

  it('defaults to 2 when the source has no indented line (minified)', () => {
    // No line begins with whitespace + `"`, so the regex misses and the
    // optional-chained match access falls through to the default. Kills the
    // optional-chaining mutant: without `?.` this input would throw on `m[1]`.
    expect(detectIndent('{"name":"x"}')).toBe(2);
  });

  it('samples only a line-leading indent, not an inline space before a quote', () => {
    // Line 1 carries an inline ` "` (space-before-quote) that is NOT at the
    // line start; the real indent is the 4 spaces on line 2. The `^` anchor
    // must skip the inline match and report 4 — without it the regex grabs the
    // single inline space and reports 1. Kills the `^`-removal regex mutant.
    expect(detectIndent('{ "compact": 1,\n    "name": "x"\n}')).toBe(4);
  });
});

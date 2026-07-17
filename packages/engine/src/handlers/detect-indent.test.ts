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
    expect(detectIndent('{"name":"x"}')).toBe(2);
  });
});

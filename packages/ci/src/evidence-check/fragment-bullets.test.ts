import { describe, expect, it } from 'vitest';

import { fragmentBullets } from './fragment-bullets.js';

const PATH = 'changelog.d/2026-10-05-x.md';

describe('fragmentBullets', () => {
  it('returns each bullet with the fragment path and its 1-based line', () => {
    expect(fragmentBullets(PATH, '- Fixed: a\n\nprose\n- Added: b (no fixture: x)\n')).toEqual([
      { path: PATH, line: 1, text: '- Fixed: a' },
      { path: PATH, line: 4, text: '- Added: b (no fixture: x)' },
    ]);
  });

  it('counts lines across CRLF endings without keeping the carriage return', () => {
    expect(fragmentBullets(PATH, 'title\r\n- Fixed: a\r\n')).toEqual([{ path: PATH, line: 2, text: '- Fixed: a' }]);
  });

  it('returns nothing for a fragment with no bullet', () => {
    expect(fragmentBullets(PATH, 'Fixed: prose only.\n**- not a bullet**\n')).toEqual([]);
  });

  it('includes indented sub-bullets', () => {
    expect(fragmentBullets(PATH, '- a\n  - b\n')).toEqual([
      { path: PATH, line: 1, text: '- a' },
      { path: PATH, line: 2, text: '  - b' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { detectCommonMistakes } from './detect-common-mistakes.js';

describe('detectCommonMistakes', () => {
  it('returns no hints for a non-object root', () => {
    expect(detectCommonMistakes('not-an-object')).toEqual([]);
    expect(detectCommonMistakes(null)).toEqual([]);
    expect(detectCommonMistakes(['array', 'root'])).toEqual([]);
  });

  it('returns no hints for a well-formed root', () => {
    expect(
      detectCommonMistakes({ putitoutthere: { version: 1 }, package: [{ kind: 'npm', globs: ['**'] }] }),
    ).toEqual([]);
  });

  it('hints a root-level version with no [putitoutthere] table', () => {
    expect(detectCommonMistakes({ version: 1 })).toEqual([
      'missing [putitoutthere] table — move `version` under it: `[putitoutthere]\\nversion = 1`',
    ]);
    expect(detectCommonMistakes({ version: 1, putitoutthere: {} })).toEqual([]);
  });

  it('hints [[packages]] only when [[package]] is absent', () => {
    expect(detectCommonMistakes({ packages: [] })).toEqual([
      'top-level table is `[[packages]]` (plural) but should be `[[package]]` (singular)',
    ]);
    expect(detectCommonMistakes({ packages: [], package: [] })).toEqual([]);
  });

  it('hints registry→kind and files→globs per entry, read from [[packages]] when [[package]] is absent', () => {
    expect(
      detectCommonMistakes({
        packages: [{ registry: 'npm', files: ['**'] }, { registry: 'npm', kind: 'npm', files: [], globs: [] }],
      }),
    ).toEqual([
      'top-level table is `[[packages]]` (plural) but should be `[[package]]` (singular)',
      'package[0]: `registry = ...` is not a valid field; did you mean `kind`?',
      'package[0]: `files = ...` is not a valid field; did you mean `globs`?',
    ]);
  });

  it('skips non-object entries while still hinting on object ones', () => {
    expect(
      detectCommonMistakes({ package: ['a-bare-string', null, { registry: 'npm' }] }),
    ).toEqual(['package[2]: `registry = ...` is not a valid field; did you mean `kind`?']);
  });

  it('ignores a non-array package value', () => {
    expect(detectCommonMistakes({ package: { registry: 'npm' } })).toEqual([]);
  });
});

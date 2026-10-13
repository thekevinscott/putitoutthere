import { describe, expect, it } from 'vitest';

import { collectBinsFromManifest } from './collect-bins-from-manifest.js';

describe('collectBinsFromManifest', () => {
  it('collects every named [[bin]] and skips the implicit package name', () => {
    expect(
      collectBinsFromManifest({
        package: { name: 'pkg' },
        bin: [{ name: 'one' }, { name: 'two', path: 'src/two.rs' }],
      }),
    ).toEqual(['one', 'two']);
  });

  it('ignores [[bin]] entries that are not tables or have no string name', () => {
    expect(
      collectBinsFromManifest({
        bin: ['loose', null, { path: 'src/x.rs' }, { name: 3 }, { name: 'real' }],
      }),
    ).toEqual(['real']);
  });

  it('falls back to [package].name when no [[bin]] is declared', () => {
    expect(collectBinsFromManifest({ package: { name: 'pkg' } })).toEqual(['pkg']);
    expect(collectBinsFromManifest({ package: { name: 'pkg' }, bin: 'nope' })).toEqual(['pkg']);
  });

  it('returns nothing without bins or a string package name', () => {
    expect(collectBinsFromManifest({})).toEqual([]);
    expect(collectBinsFromManifest({ package: { version: '1.0.0' } })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { collectBinsFromManifest } from './collect-bins-from-manifest.js';

describe('collectBinsFromManifest', () => {
  it('collects names from explicit [[bin]] entries', () => {
    expect(collectBinsFromManifest({ bin: [{ name: 'a' }, { name: 'b' }] })).toEqual(['a', 'b']);
  });

  it('skips malformed [[bin]] entries', () => {
    expect(collectBinsFromManifest({ bin: ['junk', null, { name: 42 }, { name: 'ok' }] })).toEqual([
      'ok',
    ]);
  });

  it('falls back to the implicit [package].name binary when no [[bin]] is declared', () => {
    expect(collectBinsFromManifest({ package: { name: 'mycrate' } })).toEqual(['mycrate']);
  });

  it('does not add the implicit name when explicit bins exist', () => {
    expect(collectBinsFromManifest({ bin: [{ name: 'a' }], package: { name: 'mycrate' } })).toEqual([
      'a',
    ]);
  });

  it('returns empty for a manifest with neither bins nor a package name', () => {
    expect(collectBinsFromManifest({})).toEqual([]);
  });
});

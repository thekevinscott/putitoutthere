import { describe, expect, it } from 'vitest';

import { readHandlerMeta } from './read-handler-meta.js';

describe('readHandlerMeta', () => {
  it('reads back tool-version metadata stored under the shared key', () => {
    const err = Object.assign(new Error('twine upload failed'), {
      __piotHandlerMeta: { toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' } },
    });
    expect(readHandlerMeta(err)).toEqual({
      toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
    });
  });

  it('returns undefined for an Error without attached meta', () => {
    expect(readHandlerMeta(new Error('plain'))).toBeUndefined();
  });

  it('returns undefined for non-Error values', () => {
    expect(readHandlerMeta('a string')).toBeUndefined();
    expect(readHandlerMeta(undefined)).toBeUndefined();
    expect(readHandlerMeta(null)).toBeUndefined();
  });

  it('ignores the key on a non-Error carrier', () => {
    expect(readHandlerMeta({ __piotHandlerMeta: { toolVersions: {} } })).toBeUndefined();
  });
});

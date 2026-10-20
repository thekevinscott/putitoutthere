import { describe, expect, it } from 'vitest';

import { attachHandlerMeta } from './attach-handler-meta.js';

describe('attachHandlerMeta', () => {
  it('stores tool-version metadata on the Error under the shared key', () => {
    const err = new Error('twine upload failed');
    attachHandlerMeta(err, {
      toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
    });
    expect((err as Error & { __piotHandlerMeta?: unknown }).__piotHandlerMeta).toEqual({
      toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
    });
  });

  it('returns the same Error so callers can throw inline', () => {
    const err = new Error('x');
    const same = attachHandlerMeta(err, { toolVersions: { tool: '1.0.0' } });
    expect(same).toBe(err);
  });
});

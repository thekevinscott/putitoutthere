/**
 * Pins the "published, but not the release we published" check. A committed
 * release will not grow a missing artifact later, so this must read as a
 * broken artifact set — never as something to wait out.
 */

import { describe, expect, it } from 'vitest';

import { releaseShapeError } from './release-shape-error.js';

const WHEEL = { filename: 'x-1-py3-none-any.whl', url: 'https://f/w.whl' };
const SDIST = { filename: 'x-1.tar.gz', url: 'https://f/s.tar.gz' };

describe('releaseShapeError', () => {
  it('accepts a release carrying both artifact kinds', () => {
    expect(releaseShapeError('x==1', { wheels: [WHEEL], sdists: [SDIST] })).toBeNull();
  });

  it('names a wheel-less release', () => {
    expect(releaseShapeError('x==1', { wheels: [], sdists: [SDIST] })).toBe(
      '::error::x==1 is published to TestPyPI but its release lists no wheel',
    );
  });

  it('names an sdist-less release', () => {
    expect(releaseShapeError('x==1', { wheels: [WHEEL], sdists: [] })).toBe(
      '::error::x==1 is published to TestPyPI but its release lists no sdist',
    );
  });

  it('says the release is published, never that an index is lagging', () => {
    // The whole point of the check: this state is terminal, and the message
    // must not send a reader looking for propagation delay.
    const line = releaseShapeError('x==1', { wheels: [], sdists: [] });
    expect(line).toContain('is published to TestPyPI');
    expect(line).not.toContain('lag');
  });
});

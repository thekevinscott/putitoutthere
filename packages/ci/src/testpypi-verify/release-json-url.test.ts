/**
 * Pins the release-metadata URL: same instance as the configured index, the
 * `/pypi/{package}/{version}/json` path, and the `null` an unparseable index
 * URL yields instead of a throw.
 */

import { describe, expect, it } from 'vitest';

import { releaseJsonUrl } from './release-json-url.js';

describe('releaseJsonUrl', () => {
  it('builds the version-pinned URL on the index URL\'s origin', () => {
    expect(releaseJsonUrl('https://test.pypi.org/simple/', 'piot-fixture-zzz-python-hatch', '0.0.1')).toBe(
      'https://test.pypi.org/pypi/piot-fixture-zzz-python-hatch/0.0.1/json',
    );
  });

  it('follows the configured instance rather than hard-coding TestPyPI', () => {
    // The gate must never read one registry's index and another's metadata.
    expect(releaseJsonUrl('https://pypi.org/simple/', 'x', '1')).toBe('https://pypi.org/pypi/x/1/json');
  });

  it('drops the index path, however it is written', () => {
    expect(releaseJsonUrl('https://test.pypi.org/simple', 'x', '1')).toBe('https://test.pypi.org/pypi/x/1/json');
    expect(releaseJsonUrl('https://test.pypi.org/simple///', 'x', '1')).toBe('https://test.pypi.org/pypi/x/1/json');
  });

  it('keeps a non-default port, so a local mirror still resolves', () => {
    expect(releaseJsonUrl('http://localhost:8080/simple/', 'x', '1')).toBe('http://localhost:8080/pypi/x/1/json');
  });

  it('returns null for an unparseable index URL instead of throwing', () => {
    expect(releaseJsonUrl('not a url', 'x', '1')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { npmVersionDocUrl } from './version-doc-url.js';

describe('npmVersionDocUrl', () => {
  it('defaults to the public registry, keeping @ literal and / encoded', () => {
    expect(npmVersionDocUrl('@scope/pkg', '1.0.0')).toBe(
      'https://registry.npmjs.org/@scope%2Fpkg/1.0.0',
    );
  });

  it('leaves an unscoped name untouched', () => {
    expect(npmVersionDocUrl('pkg', '1.0.0')).toBe('https://registry.npmjs.org/pkg/1.0.0');
  });

  it('reads from an explicit registry, encoding the name the same way', () => {
    expect(npmVersionDocUrl('@scope/pkg', '2.3.4', 'http://localhost:4873')).toBe(
      'http://localhost:4873/@scope%2Fpkg/2.3.4',
    );
  });

  it('drops a trailing slash so the path never doubles up', () => {
    expect(npmVersionDocUrl('pkg', '1.0.0', 'http://localhost:4873/')).toBe(
      'http://localhost:4873/pkg/1.0.0',
    );
  });

  it('falls back to the public registry for an empty registry string', () => {
    // The workflow passes `REGISTRY_URL: ''` on the lanes that read real npm,
    // so an empty string has to mean "default", not "no host".
    expect(npmVersionDocUrl('pkg', '1.0.0', '')).toBe('https://registry.npmjs.org/pkg/1.0.0');
  });

  it('keeps a prerelease version verbatim', () => {
    expect(npmVersionDocUrl('pkg', '0.0.0-never-published')).toBe(
      'https://registry.npmjs.org/pkg/0.0.0-never-published',
    );
  });
});

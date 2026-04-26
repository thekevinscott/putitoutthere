/**
 * VitePress config smoke test.
 *
 * Verifies the site's config is importable and exposes the keys the
 * rest of the build assumes. If this test breaks, the site won't
 * build — catch it earlier.
 */

import { describe, expect, it } from 'vitest';

import config from '../../.vitepress/config.js';

describe('vitepress config', () => {
  it('has a title + description', () => {
    expect(config.title).toBe('Put It Out There');
    expect(config.description).toBeTruthy();
  });

  it('exposes a base path for GitHub Pages', () => {
    expect(config.base).toBe('/putitoutthere/');
  });

  it('wires up the expected navigation items', () => {
    const nav = config.themeConfig?.nav ?? [];
    const labels = nav.map((item) => item.text);
    expect(labels).toContain('Getting Started');
    expect(labels).toContain('Guide');
  });

  it('has a sidebar for /guide/', () => {
    const sidebar = config.themeConfig?.sidebar ?? {};
    expect(sidebar['/guide/']).toBeTruthy();
  });
});

/**
 * Exact-text test: the output is parsed by the engine's config loader, which
 * rejects a package missing `name` / `path` / a non-empty `globs`, and derives
 * the tag from `tag_format`'s default. Asserting the whole document is the
 * only way a missing key shows up here rather than as a reconcile crash
 * halfway through the e2e lane.
 */

import { describe, expect, it } from 'vitest';

import { fixtureConfigToml } from './fixture-config-toml.js';

describe('fixtureConfigToml', () => {
  it('names every expected project as a pypi package', () => {
    expect(
      fixtureConfigToml([
        { name: 'piot-fixture-zzz-python-hatch', version: '0.0.1', tag: 'ignored' },
        { name: 'piot-fixture-zzz-python-sdist', version: '0.0.2', tag: 'ignored' },
      ]),
    ).toBe(
      `[putitoutthere]
version = 1

[[package]]
name = "piot-fixture-zzz-python-hatch"
kind = "pypi"
path = "."
globs = ["**"]

[[package]]
name = "piot-fixture-zzz-python-sdist"
kind = "pypi"
path = "."
globs = ["**"]
`,
    );
  });

  it('emits a loadable config with a single package', () => {
    expect(fixtureConfigToml([{ name: 'solo', version: '1.0', tag: 'solo-v1.0' }])).toBe(
      `[putitoutthere]
version = 1

[[package]]
name = "solo"
kind = "pypi"
path = "."
globs = ["**"]
`,
    );
  });
});

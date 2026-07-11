/**
 * `computeSkew` (#412, #403 slice 4): a PUBLISHing dependent whose
 * `depends_on` dependency SKIPs is the dangerous shape. Exercises the
 * publish/skip pairing, the skipped-dependent short-circuit, absent
 * packages (no `depends_on`), and multi-dependency fan-out.
 */

import { describe, expect, it } from 'vitest';

import type { Package } from './config.js';
import type { PlanVerdict, Verdict } from './plan-status-types.js';
import { computeSkew } from './plan-skew.js';

function verdict(pkg: string, v: Verdict): PlanVerdict {
  return { package: pkg, kind: 'crates', version: '1.0.0', verdict: v };
}

function pkg(name: string, depends_on: string[] = []): Package {
  return {
    name,
    kind: 'crates',
    path: name,
    globs: [],
    depends_on,
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

function byName(...pkgs: Package[]): ReadonlyMap<string, Package> {
  return new Map(pkgs.map((p) => [p.name, p]));
}

describe('computeSkew', () => {
  it('warns when a publishing dependent relies on a skipping dependency', () => {
    const skew = computeSkew(
      [verdict('app', 'publish'), verdict('core', 'skip')],
      byName(pkg('app', ['core']), pkg('core')),
    );
    expect(skew).toEqual([{ dependent: 'app', dependency: 'core' }]);
  });

  it('does not warn when the dependency also publishes', () => {
    const skew = computeSkew(
      [verdict('app', 'publish'), verdict('core', 'publish')],
      byName(pkg('app', ['core']), pkg('core')),
    );
    expect(skew).toEqual([]);
  });

  it('does not warn when the dependency verdict is unknown (not skip)', () => {
    const skew = computeSkew(
      [verdict('app', 'publish'), verdict('core', 'unknown')],
      byName(pkg('app', ['core']), pkg('core')),
    );
    expect(skew).toEqual([]);
  });

  it('ignores a skipped dependent even if its dependency skips', () => {
    const skew = computeSkew(
      [verdict('app', 'skip'), verdict('core', 'skip')],
      byName(pkg('app', ['core']), pkg('core')),
    );
    expect(skew).toEqual([]);
  });

  it('treats a package missing from the map as having no dependencies', () => {
    const skew = computeSkew([verdict('app', 'publish')], byName());
    expect(skew).toEqual([]);
  });

  it('emits one warning per skipping dependency of a publishing dependent', () => {
    const skew = computeSkew(
      [verdict('app', 'publish'), verdict('a', 'skip'), verdict('b', 'skip'), verdict('c', 'publish')],
      byName(pkg('app', ['a', 'b', 'c'])),
    );
    expect(skew).toEqual([
      { dependent: 'app', dependency: 'a' },
      { dependent: 'app', dependency: 'b' },
    ]);
  });
});

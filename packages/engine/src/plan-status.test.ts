/**
 * `computePlanStatus` unit coverage (#412, #403 slice 4).
 *
 * The subject layers a per-package verdict (PUBLISH / SKIP / UNKNOWN)
 * over the build matrix and derives dependency skew. Its collaborators
 * are isolated: `loadConfig`, `plan`, and `handlerFor` are automocked and
 * driven per scenario, so each case exercises the verdict loop and the
 * degrade-to-`unknown` catch without a real repo or registry. The pure
 * `computeSkew` runs for real. End-to-end behaviour (and the CLI's
 * `--json` / human rendering) is pinned at the integration + e2e tiers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { loadConfig } from './config.js';
import { handlerFor } from './handlers/index.js';
import type { MatrixRow } from './plan.js';
import { plan } from './plan.js';
import { computePlanStatus } from './plan-status.js';
import type { Ctx, Handler } from './types.js';

vi.mock('./config.js');
vi.mock('./plan.js');
vi.mock('./handlers/index.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function pkg(name: string, depends_on: string[] = []): Package {
  return {
    name,
    kind: 'crates',
    crate: name,
    path: `packages/${name}`,
    globs: [`packages/${name}/**`],
    depends_on,
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

function configWith(...packages: Package[]): void {
  vi.mocked(loadConfig).mockResolvedValue({
    putitoutthere: { version: 1 },
    packages,
  });
}

function row(name: string): MatrixRow {
  return {
    name,
    kind: 'crates',
    version: '1.0.0',
    target: 'noarch',
    runs_on: 'ubuntu-latest',
    artifact_name: `${name}-crate`,
    artifact_path: 'target/package',
    path: `packages/${name}`,
  };
}

/**
 * Install a handler whose `isPublished` verdict is keyed by package name:
 * `published` names resolve true (→ SKIP), `throws` names reject (→
 * UNKNOWN), everything else resolves false (→ PUBLISH).
 */
function stubHandler(opts: { published?: string[]; throws?: string[] }): void {
  const published = new Set(opts.published ?? []);
  const throwing = new Set(opts.throws ?? []);
  const handler: Handler = {
    kind: 'crates',
    isPublished: vi.fn((p: { name: string }) => {
      if (throwing.has(p.name)) {return Promise.reject(new Error('registry down'));}
      return Promise.resolve(published.has(p.name));
    }),
    latestVersion: vi.fn().mockResolvedValue(null),
    trustPosture: vi.fn().mockResolvedValue('token'),
    writeVersion: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ status: 'published', url: 'x' }),
  };
  vi.mocked(handlerFor).mockReturnValue(handler);
}

describe('computePlanStatus', () => {
  it('assigns skip/publish verdicts per package and reports no skew when none applies', async () => {
    configWith(pkg('a'), pkg('b'));
    vi.mocked(plan).mockResolvedValue([row('a'), row('b')]);
    stubHandler({ published: ['a'] }); // a already published → skip; b → publish

    const out = await computePlanStatus({ cwd: '/repo', releasePackages: 'a@1.0.0, b@1.0.0' });

    expect(out.matrix.map((r) => r.name).sort()).toEqual(['a', 'b']);
    expect(Object.fromEntries(out.verdicts.map((v) => [v.package, v.verdict]))).toEqual({
      a: 'skip',
      b: 'publish',
    });
    expect(out.skew).toEqual([]);
  });

  it('reports unknown for an unreachable registry and flags a publish-over-skip dependency skew', async () => {
    // wrap PUBLISHes and depends on core (SKIP → skew) and flaky
    // (UNKNOWN, not skip → no skew pair).
    configWith(pkg('core'), pkg('wrap', ['core', 'flaky']), pkg('flaky'));
    vi.mocked(plan).mockResolvedValue([row('core'), row('wrap'), row('flaky')]);
    stubHandler({ published: ['core'], throws: ['flaky'] });

    const out = await computePlanStatus({ cwd: '/repo' });

    expect(Object.fromEntries(out.verdicts.map((v) => [v.package, v.verdict]))).toEqual({
      core: 'skip',
      wrap: 'publish',
      flaky: 'unknown',
    });
    // The dependent publishing ahead of its skipped dependency is the skew.
    expect(out.skew).toEqual([{ dependent: 'wrap', dependency: 'core' }]);
  });

  it('emits one verdict per package even when the matrix fans a package across rows, threading an inert-artifacts ctx', async () => {
    configWith(pkg('a'));
    // Two matrix rows for the same package (e.g. a multi-target fan): the
    // second must hit the `seen.has(row.name)` dedup `continue`.
    vi.mocked(plan).mockResolvedValue([row('a'), row('a')]);
    const probe: { got?: string; had?: boolean } = {};
    const handler: Handler = {
      kind: 'crates',
      isPublished: vi.fn((_p: { name: string }, _v: string, ctx: Ctx) => {
        // The verdict loop builds a Ctx with stub artifact accessors.
        probe.got = ctx.artifacts.get('anything');
        probe.had = ctx.artifacts.has('anything');
        return Promise.resolve(false);
      }),
      latestVersion: vi.fn().mockResolvedValue(null),
      trustPosture: vi.fn().mockResolvedValue('token'),
      writeVersion: vi.fn().mockResolvedValue([]),
      publish: vi.fn().mockResolvedValue({ status: 'published', url: 'x' }),
    };
    vi.mocked(handlerFor).mockReturnValue(handler);

    const out = await computePlanStatus({ cwd: '/repo' });

    expect(out.verdicts).toHaveLength(1);
    expect(out.verdicts[0]!.package).toBe('a');
    expect(handler.isPublished).toHaveBeenCalledTimes(1);
    expect(probe.got).toBe('');
    expect(probe.had).toBe(false);
  });
});

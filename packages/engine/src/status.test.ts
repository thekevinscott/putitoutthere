/**
 * `computeStatus` unit tests.
 *
 * `computeStatus` is the subject here: it reconciles each configured
 * package's latest git tag against its registry latest and classifies
 * the drift. Its collaborators are isolated — `loadConfig` and `lastTag`
 * are automocked and driven per scenario, the registry is an injected
 * handler, and the pure `parseTagVersion` / `classify` math runs for
 * real. The wiring — tag resolution, the per-package registry call, the
 * unreachable catch — is what this tier covers.
 *
 * The pure `classify` and `formatStatusRow` functions are unit-tested
 * directly in their own colocated suites (`status-classify.test.ts`,
 * `status-format.test.ts`); the registry-vs-tag drift the feature exists
 * to catch is pinned end-to-end in
 * `test/integration/status.integration.test.ts`.
 *
 * Issue #403.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Package } from './config.js';
import { loadConfig } from './config.js';
import { lastTag } from './git.js';
import { computeStatus } from './status.js';
import type { Handler, PackageConfig } from './types.js';

vi.mock('./config.js');
vi.mock('./git.js');

beforeEach(() => {
  vi.clearAllMocks();
});

function pkg(name: string): Package {
  return {
    name,
    kind: 'npm',
    path: name,
    globs: [`${name}/**`],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  };
}

/** Drive `loadConfig` to return exactly these packages. */
function configWith(...packages: Package[]): void {
  vi.mocked(loadConfig).mockReturnValue({
    putitoutthere: { version: 1 },
    packages,
  });
}

function handlerReturning(latest: (name: string) => Promise<string | null>): Handler {
  return {
    kind: 'npm',
    isPublished: vi.fn().mockResolvedValue(false),
    latestVersion: (p: PackageConfig) => latest(p.name),
    trustPosture: vi.fn().mockResolvedValue('token'),
    writeVersion: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({ status: 'published', url: 'x' }),
  };
}

describe('computeStatus', () => {
  it('classifies in-sync, published-untagged, and unreachable across packages', async () => {
    configWith(pkg('a'), pkg('b'), pkg('c'));
    // a + c are tagged at v1.0.0; b has never been tagged.
    vi.mocked(lastTag).mockImplementation((name) =>
      name === 'b' ? null : `${name}-v1.0.0`,
    );

    const handler = handlerReturning((name) => {
      if (name === 'a') {return Promise.resolve('1.0.0');} // matches its tag → in sync
      if (name === 'b') {return Promise.resolve('2.0.0');} // live but no tag → drift
      return Promise.reject(new Error('registry down')); // c → unreachable
    });

    const rows = await computeStatus({ cwd: '/repo', handlerFor: () => handler });
    const byName = Object.fromEntries(rows.map((r) => [r.package, r]));

    expect(byName.a!.state).toBe('in sync');
    expect(byName.a!.tagVersion).toBe('1.0.0');
    expect(byName.a!.drift).toBe(false);

    expect(byName.b!.state).toBe('published, untagged');
    expect(byName.b!.tag).toBeNull();
    expect(byName.b!.registry).toBe('2.0.0');
    expect(byName.b!.drift).toBe(true);

    expect(byName.c!.state).toBe('registry unreachable');
    expect(byName.c!.registryUnreachable).toBe(true);
    expect(byName.c!.registry).toBeNull();
    expect(byName.c!.drift).toBe(false);
  });
});

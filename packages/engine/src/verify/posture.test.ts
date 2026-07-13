/**
 * `computeVerify` unit coverage — the colocated unit under test. Isolated:
 * the config loader (`loadConfig`), the handler registry (`handlerFor`) and
 * the logger (`createLogger`) are mocked, so each case drives one posture
 * branch off the mocked handler's `latestVersion` / `trustPosture` returns:
 * `oidc` / `token` / `unpublished` (no release, trust never read) /
 * `unreachable` (a read throws, on either the version or the trust probe).
 *
 * The CLI wiring this once drove end-to-end — `--json` / `--check` /
 * rendering, the live crates reads, cross-registry behaviour — is exercised
 * at the integration + e2e tiers (`test/integration/verify.integration.test.ts`)
 * and the renderer at `posture-format.test.ts`, so this stays a focused unit
 * over the classification the engine owns.
 *
 * Issue #414, #403 slice 5.
 */

import { describe, expect, it, vi } from 'vitest';

import { computeVerify } from './posture.js';
import { type Config, loadConfig } from '../config.js';
import { handlerFor } from '../handlers/index.js';

vi.mock('../config.js');
vi.mock('../handlers/index.js');
vi.mock('../log.js');

const loadConfigMock = vi.mocked(loadConfig);
const handlerForMock = vi.mocked(handlerFor);

type Pkg = Config['packages'][number];

/**
 * A config whose five packages each name the posture they should classify
 * to, so the mocked handler can key its per-read behaviour off the name.
 */
function configWith(names: string[]): Config {
  const packages = names.map((name) => ({
    name,
    kind: 'crates',
    crate: name,
    path: `packages/${name}`,
    globs: [`packages/${name}/**`],
  }));
  return { putitoutthere: { version: 1 }, packages } as unknown as Config;
}

/**
 * The per-kind handler `computeVerify` dispatches to, driven by package
 * name: `pkg-unpub` was never published (null), `pkg-latestflaky` throws on
 * the version read, `pkg-trustflaky` publishes but throws on the trust read,
 * `pkg-oidc` is a trusted publisher, everything else is token-authed.
 */
function stubHandler(): void {
  handlerForMock.mockReturnValue({
    latestVersion: vi.fn((pkg: Pkg) => {
      switch (pkg.name) {
        case 'pkg-unpub': return Promise.resolve(null);
        case 'pkg-latestflaky': return Promise.reject(new Error('503'));
        case 'pkg-trustflaky': return Promise.resolve('2.0.0');
        default: return Promise.resolve('1.0.0');
      }
    }),
    trustPosture: vi.fn((pkg: Pkg) => {
      switch (pkg.name) {
        case 'pkg-oidc': return Promise.resolve('oidc');
        case 'pkg-trustflaky': return Promise.reject(new Error('503'));
        default: return Promise.resolve('token');
      }
    }),
  } as unknown as ReturnType<typeof handlerFor>);
}

describe('computeVerify', () => {
  it('classifies every posture', async () => {
    loadConfigMock.mockReturnValue(
      configWith(['pkg-oidc', 'pkg-token', 'pkg-unpub', 'pkg-latestflaky', 'pkg-trustflaky']),
    );
    stubHandler();

    const rows = await computeVerify({ cwd: '/repo' });
    const byPkg = Object.fromEntries(rows.map((r) => [r.package, r]));

    expect(byPkg['pkg-oidc']).toMatchObject({ version: '1.0.0', posture: 'oidc' });
    expect(byPkg['pkg-token']).toMatchObject({ version: '1.0.0', posture: 'token' });
    // Never published: no release to attribute, so trust is not read.
    expect(byPkg['pkg-unpub']).toMatchObject({ version: null, posture: 'unpublished' });
    // A throwing version read reports unreachable without a version.
    expect(byPkg['pkg-latestflaky']).toMatchObject({ version: null, posture: 'unreachable' });
    // A throwing trust read reports unreachable but keeps the read version.
    expect(byPkg['pkg-trustflaky']).toMatchObject({ version: '2.0.0', posture: 'unreachable' });
  });

  it('does not read trust for an unpublished package', async () => {
    loadConfigMock.mockReturnValue(configWith(['pkg-unpub']));
    stubHandler();

    const rows = await computeVerify({ cwd: '/repo' });
    const handler = handlerForMock.mock.results[0]!.value as ReturnType<typeof handlerFor>;

    expect(rows).toEqual([{ package: 'pkg-unpub', kind: 'crates', version: null, posture: 'unpublished' }]);
    expect(vi.mocked(handler.trustPosture)).not.toHaveBeenCalled();
  });
});

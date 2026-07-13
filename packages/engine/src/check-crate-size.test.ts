/**
 * Unit tests for `checkCratesPackageSize` (#362).
 *
 * The file under test is `check-crate-size.ts`. Its only dependency
 * outside itself is the `cargo package` subprocess, mocked here at the
 * `spawnSync` boundary — so these cases call the check function
 * directly with hand-built packages, with no git repo, config loader,
 * or Rust toolchain involved. They own branch coverage of the module.
 *
 * The end-to-end path through `runChecks` (real config loader, real
 * check dispatch) is covered by
 * `test/integration/check-crate-size.integration.test.ts`.
 */

import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Bare automock (no factory): vitest generates the double from the real
// module, so it can't drift from the source — satisfying the unit-suite
// isolation lint without a hand-written (untyped) factory. Only spawnSync
// is exercised; the real `cargo package` subprocess round-trip is covered
// by test/integration/check-crate-size.integration.test.ts.
vi.mock('node:child_process');

import { checkCratesPackageSize } from './check-crate-size.js';
import type { Package } from './config.js';

const spawnMock = vi.mocked(spawnSync);

function makePkg(kind: Package['kind'], name = `${kind}-pkg`): Package {
  return {
    name,
    kind,
    path: 'packages/pkg',
    globs: ['packages/pkg/**'],
    depends_on: [],
    first_version: '0.1.0',
    tag_format: '{name}-v{version}',
  } as unknown as Package;
}

/** A `cargo package` run that exited 0 and reported `compressed` size. */
function cargoPackaged(compressed: string): SpawnSyncReturnsString {
  const stderr = `   Packaging rust-lib v0.1.0 (/tmp/repo)\n    Packaged 7 files, 24.0KiB (${compressed} compressed)\n`;
  return { pid: 1, output: ['', stderr], stdout: '', stderr, status: 0, signal: null };
}

/** A `cargo package` run that exited 0 with arbitrary `stderr`. */
function cargoExit0(stderr: string): SpawnSyncReturnsString {
  return { pid: 1, output: ['', stderr], stdout: '', stderr, status: 0, signal: null };
}

type SpawnSyncReturnsString = ReturnType<typeof spawnSync> & { stderr: string };

afterEach(() => {
  spawnMock.mockReset();
});

describe('checkCratesPackageSize (#362)', () => {
  it("flags a crates package whose .crate exceeds crates.io's 10 MiB limit", () => {
    spawnMock.mockReturnValue(cargoPackaged('133.6MiB'));
    const findings = checkCratesPackageSize([makePkg('crates', 'rust-lib')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.package).toBe('rust-lib');
    expect(findings[0]!.message).toMatch(/PIOT_CRATES_PACKAGE_TOO_LARGE/);
    expect(findings[0]!.message).toMatch(/133\.6 MiB/);
    expect(findings[0]!.message).toMatch(/10\.0 MiB|10485760/);
    expect(findings[0]!.message).toMatch(/413 Payload Too Large/);
  });

  it('does not flag a crates package whose .crate is within the limit', () => {
    spawnMock.mockReturnValue(cargoPackaged('2.0MiB'));
    expect(checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo is absent (spawnSync reports an error)', () => {
    spawnMock.mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: Object.assign(new Error('spawnSync cargo ENOENT'), { code: 'ENOENT' }),
    });
    expect(checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo package exits non-zero', () => {
    spawnMock.mockReturnValue({
      pid: 1,
      output: ['', 'error: failed to parse manifest\n'],
      stdout: '',
      stderr: 'error: failed to parse manifest\n',
      status: 101,
      signal: null,
    });
    expect(checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when spawnSync itself throws', () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    expect(checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo output carries no Packaged size line', () => {
    spawnMock.mockReturnValue(cargoExit0('   Compiling rust-lib v0.1.0\n'));
    expect(checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo reports an unrecognised size unit', () => {
    spawnMock.mockReturnValue(
      cargoExit0('    Packaged 7 files, 24.0KiB (5.0ZB compressed)\n'),
    );
    expect(checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('skips non-crates packages without invoking cargo', () => {
    expect(checkCratesPackageSize([makePkg('npm'), makePkg('pypi')])).toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

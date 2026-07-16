/**
 * Unit tests for `checkCratesPackageSize` (#362).
 *
 * The file under test is `check-crate-size.ts`. Its only dependency
 * outside itself is the `cargo package` subprocess, mocked here at the
 * async process seam (`execCapture`) — so these cases call the check
 * function directly with hand-built packages, with no git repo, config
 * loader, or Rust toolchain involved. They own branch coverage of the
 * module.
 *
 * The end-to-end path through `runChecks` (real config loader, real
 * check dispatch) is covered by
 * `tests/integration/check-crate-size.integration.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { execCapture, type ExecResult } from './utils/exec-capture.js';
import { ExecError } from './utils/exec-error.js';

vi.mock('./utils/exec-capture.js');

import { checkCratesPackageSize } from './check-crate-size.js';
import type { Package } from './config.js';

const execMock = vi.mocked(execCapture);

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
function cargoPackaged(compressed: string): ExecResult {
  const stderr = `   Packaging rust-lib v0.1.0 (/tmp/repo)\n    Packaged 7 files, 24.0KiB (${compressed} compressed)\n`;
  return { stdout: '', stderr };
}

/** A `cargo package` run that exited 0 with arbitrary `stderr`. */
function cargoExit0(stderr: string): ExecResult {
  return { stdout: '', stderr };
}

afterEach(() => {
  execMock.mockReset();
});

describe('checkCratesPackageSize (#362)', () => {
  it("flags a crates package whose .crate exceeds crates.io's 10 MiB limit", async () => {
    execMock.mockResolvedValue(cargoPackaged('133.6MiB'));
    const findings = await checkCratesPackageSize([makePkg('crates', 'rust-lib')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.package).toBe('rust-lib');
    expect(findings[0]!.message).toMatch(/PIOT_CRATES_PACKAGE_TOO_LARGE/);
    expect(findings[0]!.message).toMatch(/133\.6 MiB/);
    expect(findings[0]!.message).toMatch(/10\.0 MiB|10485760/);
    expect(findings[0]!.message).toMatch(/413 Payload Too Large/);
  });

  it('does not flag a crates package whose .crate is within the limit', async () => {
    execMock.mockResolvedValue(cargoPackaged('2.0MiB'));
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo is absent (execCapture rejects with status null)', async () => {
    execMock.mockRejectedValue(new ExecError('spawn cargo ENOENT', '', '', null));
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo package exits non-zero', async () => {
    execMock.mockRejectedValue(
      new ExecError('cargo failed', '', 'error: failed to parse manifest\n', 101),
    );
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing on any other rejection (matches the old swallow-all guard)', async () => {
    // The prior spawnSync path wrapped the call in try/catch → null on any
    // throw. A non-ExecError rejection stays "can't verify", so skip.
    execMock.mockRejectedValue(new Error('unexpected'));
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo output carries no Packaged size line', async () => {
    execMock.mockResolvedValue(cargoExit0('   Compiling rust-lib v0.1.0\n'));
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('returns nothing when cargo reports an unrecognised size unit', async () => {
    execMock.mockResolvedValue(
      cargoExit0('    Packaged 7 files, 24.0KiB (5.0ZB compressed)\n'),
    );
    expect(await checkCratesPackageSize([makePkg('crates')])).toEqual([]);
  });

  it('skips non-crates packages without invoking cargo', async () => {
    expect(await checkCratesPackageSize([makePkg('npm'), makePkg('pypi')])).toEqual([]);
    expect(execMock).not.toHaveBeenCalled();
  });
});

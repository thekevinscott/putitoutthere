import { afterEach, describe, expect, it, vi } from 'vitest';

import { execCapture, type ExecResult } from './utils/exec-capture.js';
import { ExecError } from './utils/exec-error.js';

vi.mock('./utils/exec-error.js', async () => await vi.importActual<typeof import('./utils/exec-error.js')>('./utils/exec-error.js'));

vi.mock('./utils/exec-capture.js');

import { packagedCrateBytes } from './packaged-crate-bytes.js';

const execMock = vi.mocked(execCapture);

const SIZE_LINE = '    Packaged 7 files, 24.0KiB (2.0MiB compressed)\n';

function cargoExit0(stderr: string): ExecResult {
  return { stdout: '', stderr };
}

afterEach(() => {
  execMock.mockReset();
});

describe('packagedCrateBytes', () => {
  it('runs the non-mutating cargo package argv and returns the compressed size', async () => {
    execMock.mockResolvedValue(cargoExit0(SIZE_LINE));
    expect(await packagedCrateBytes('packages/pkg/Cargo.toml')).toBe(2 * 1024 * 1024);
    expect(execMock).toHaveBeenCalledWith('cargo', [
      'package',
      '--no-verify',
      '--allow-dirty',
      '--manifest-path',
      'packages/pkg/Cargo.toml',
    ]);
  });

  it('returns null when cargo output carries no Packaged size line', async () => {
    execMock.mockResolvedValue(cargoExit0('   Compiling rust-lib v0.1.0\n'));
    expect(await packagedCrateBytes('Cargo.toml')).toBeNull();
  });

  // The catch-block guards (`!(err instanceof ExecError)` and `status !== 0`)
  // gate whether a rejection's stderr is still parsed for a size. These cases
  // drive the otherwise unreachable shapes where bypassing a guard flips the
  // result.
  it('does not parse the stderr of a non-ExecError rejection even if it carries a size line', async () => {
    execMock.mockRejectedValue(Object.assign(new Error('weird'), { stderr: SIZE_LINE, status: 0 }));
    expect(await packagedCrateBytes('Cargo.toml')).toBeNull();
  });

  it('parses the size of an ExecError that (unusually) reports exit 0', async () => {
    execMock.mockRejectedValue(new ExecError('x', '', SIZE_LINE, 0));
    expect(await packagedCrateBytes('Cargo.toml')).toBe(2 * 1024 * 1024);
  });

  it('does not parse the size of a non-zero-exit ExecError even when its stderr carries one', async () => {
    execMock.mockRejectedValue(new ExecError('x', '', SIZE_LINE, 101));
    expect(await packagedCrateBytes('Cargo.toml')).toBeNull();
  });

  it('returns null when cargo is absent (execCapture rejects with status null)', async () => {
    execMock.mockRejectedValue(new ExecError('spawn cargo ENOENT', '', '', null));
    expect(await packagedCrateBytes('Cargo.toml')).toBeNull();
  });

  it('returns null on any other rejection', async () => {
    execMock.mockRejectedValue(new Error('unexpected'));
    expect(await packagedCrateBytes('Cargo.toml')).toBeNull();
  });
});

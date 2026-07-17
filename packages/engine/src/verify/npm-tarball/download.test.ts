import { mkdtemp } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadNpmTarball } from './download.js';
import { execCapture } from '../../utils/exec-capture.js';

// Bare automocks (no factory): vitest derives the doubles from the real
// modules so they can't drift, satisfying unit-suite isolation without a
// hand-written (untyped) factory. Real curl/tar/extraction is covered by
// tests/integration/verify-npm-tarball.integration.test.ts and the e2e tier.
vi.mock('../../utils/exec-capture.js');
vi.mock('node:fs/promises');

const execMock = vi.mocked(execCapture);
const mkdtempMock = vi.mocked(mkdtemp);

// mkdtemp resolves this verbatim as `root`; downstream paths are built
// from it with real `path.join`, so assertions on those stay separator-
// agnostic (this suite runs on windows/macos/ubuntu in CI).
const ROOT = 'piot-tarball-root';

beforeEach(() => {
  vi.resetAllMocks();
  execMock.mockResolvedValue({ stdout: '', stderr: '' });
  mkdtempMock.mockResolvedValue(ROOT);
});

describe('downloadNpmTarball', () => {
  it('curls the tarball, extracts it, and returns the package dir', async () => {
    const { root, packageDir } = await downloadNpmTarball('https://reg/pkg.tgz', 5);
    expect(root).toBe(ROOT);
    expect(packageDir).toMatch(/extracted[/\\]package$/);
    // The temp root is minted with the engine's `piot-tarball-` prefix.
    expect(mkdtempMock).toHaveBeenCalledWith(expect.stringContaining('piot-tarball-'));

    const curl = execMock.mock.calls.find((c) => c[0] === 'curl')!;
    const curlArgs = curl[1];
    expect(curlArgs.slice(0, 7)).toEqual([
      '-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '5', '-o',
    ]);
    expect(curlArgs[7]).toMatch(/pkg\.tgz$/);
    expect(curlArgs[8]).toBe('https://reg/pkg.tgz');

    const tar = execMock.mock.calls.find((c) => c[0] === 'tar')!;
    const tarArgs = tar[1];
    expect(tarArgs[0]).toBe('-xzf');
    expect(tarArgs[1]).toMatch(/pkg\.tgz$/);
    expect(tarArgs[2]).toBe('-C');
    expect(tarArgs[3]).toMatch(/extracted$/);
  });

  it('threads the retry-delay through to curl', async () => {
    await downloadNpmTarball('https://reg/t.tgz', 2);
    const curl = execMock.mock.calls.find((c) => c[0] === 'curl')!;
    expect(curl[1]).toContain('2');
  });
});

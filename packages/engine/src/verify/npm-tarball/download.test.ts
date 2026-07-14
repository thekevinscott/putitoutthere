import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadNpmTarball } from './download.js';

// Bare automocks (no factory): vitest derives the doubles from the real
// modules so they can't drift, satisfying unit-suite isolation without a
// hand-written (untyped) factory. Real curl/tar/extraction is covered by
// tests/integration/verify-npm-tarball.integration.test.ts and the e2e tier.
vi.mock('node:child_process');
vi.mock('node:fs');

const execMock = vi.mocked(execFileSync);
const mkdtempMock = vi.mocked(mkdtempSync);

// mkdtempSync returns this verbatim as `root`; downstream paths are built
// from it with real `path.join`, so assertions on those stay separator-
// agnostic (this suite runs on windows/macos/ubuntu in CI).
const ROOT = 'piot-tarball-root';

beforeEach(() => {
  vi.resetAllMocks();
  execMock.mockReturnValue('');
  mkdtempMock.mockReturnValue(ROOT);
});

describe('downloadNpmTarball', () => {
  it('curls the tarball, extracts it, and returns the package dir', () => {
    const { root, packageDir } = downloadNpmTarball('https://reg/pkg.tgz', 5);
    expect(root).toBe(ROOT);
    expect(packageDir).toMatch(/extracted[/\\]package$/);

    const curl = execMock.mock.calls.find((c) => c[0] === 'curl')!;
    const curlArgs = curl[1]!;
    expect(curlArgs.slice(0, 7)).toEqual([
      '-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '5', '-o',
    ]);
    expect(curlArgs[7]).toMatch(/pkg\.tgz$/);
    expect(curlArgs[8]).toBe('https://reg/pkg.tgz');

    const tar = execMock.mock.calls.find((c) => c[0] === 'tar')!;
    const tarArgs = tar[1]!;
    expect(tarArgs[0]).toBe('-xzf');
    expect(tarArgs[1]).toMatch(/pkg\.tgz$/);
    expect(tarArgs[2]).toBe('-C');
    expect(tarArgs[3]).toMatch(/extracted$/);
  });

  it('threads the retry-delay through to curl', () => {
    downloadNpmTarball('https://reg/t.tgz', 2);
    const curl = execMock.mock.calls.find((c) => c[0] === 'curl')!;
    expect(curl[1]).toContain('2');
  });
});

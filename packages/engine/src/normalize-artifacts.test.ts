/**
 * Unit tests for `normalizeArtifactLayout`.
 *
 * The integration story lives in
 * `tests/integration/artifact-layout.integration.test.ts` (the failing
 * test that drove this module's creation per #311). These unit cases
 * cover the no-op branches and edge shapes the integration tier
 * doesn't exercise: multi-artifact plans, already-subdir layouts,
 * crates-only matrices, vanilla-npm matrices, and empty/missing
 * artifact roots.
 *
 * The `node:fs` boundary is automocked so each case isolates the
 * branching logic — `existsSync` / `readdirSync` are driven to stage a
 * scenario and the move is asserted through the `mkdirSync` /
 * `renameSync` calls, not real files. Path assertions are separator-
 * agnostic so they hold on Windows as well as POSIX.
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeArtifactLayout } from './normalize-artifacts.js';
import type { MatrixRow } from './plan.js';

vi.mock('node:fs');

const existsMock = vi.mocked(existsSync);
const readdirMock = vi.mocked(readdirSync);
const mkdirMock = vi.mocked(mkdirSync);
const renameMock = vi.mocked(renameSync);

/**
 * Drive `existsSync` from a set of paths that should report present.
 * Membership is matched by suffix so callers can name a path by its
 * trailing segment without hard-coding a separator.
 */
function existing(...present: string[]): void {
  existsMock.mockImplementation((p) =>
    present.some((suffix) => String(p).endsWith(suffix)),
  );
}

/** Feed `readdirSync` a set of dumped entries. */
function dumped(...entries: string[]): void {
  readdirMock.mockReturnValue(entries as unknown as ReturnType<typeof readdirSync>);
}

beforeEach(() => {
  vi.clearAllMocks();
  existsMock.mockReturnValue(false);
  readdirMock.mockReturnValue([]);
});

const SDIST_ROW: MatrixRow = {
  name: 'pkg',
  kind: 'pypi',
  version: '1.0.0',
  target: 'sdist',
  runs_on: 'ubuntu-latest',
  artifact_name: 'pkg-sdist',
  artifact_path: 'dist',
  path: '.',
};

const WHEEL_ROW: MatrixRow = {
  name: 'pkg',
  kind: 'pypi',
  version: '1.0.0',
  target: 'x86_64-unknown-linux-gnu',
  runs_on: 'ubuntu-latest',
  artifact_name: 'pkg-wheel-x86_64-unknown-linux-gnu',
  artifact_path: 'dist',
  path: '.',
};

const CRATE_ROW: MatrixRow = {
  name: 'pkg',
  kind: 'crates',
  version: '1.0.0',
  target: 'noarch',
  runs_on: 'ubuntu-latest',
  artifact_name: 'pkg-crate',
  artifact_path: 'target/package',
  path: '.',
};

const VANILLA_NPM_ROW: MatrixRow = {
  name: 'pkg',
  kind: 'npm',
  version: '1.0.0',
  target: 'noarch',
  runs_on: 'ubuntu-latest',
  artifact_name: 'pkg-pkg',
  artifact_path: 'package.json',
  path: '.',
};

describe('#311 normalizeArtifactLayout', () => {
  it('moves a dumped sdist into <artifactsRoot>/<artifact_name>/', () => {
    // Root present, target subdir absent, one dumped file at the root.
    existing('artifacts');
    dumped('pkg-1.0.0.tar.gz');

    normalizeArtifactLayout([SDIST_ROW], 'artifacts');

    // Subdir created, the dumped file relocated under it.
    expect(mkdirMock).toHaveBeenCalledWith(
      expect.stringMatching(/artifacts[/\\]pkg-sdist$/),
      { recursive: true },
    );
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringMatching(/artifacts[/\\]pkg-1\.0\.0\.tar\.gz$/),
      expect.stringMatching(/pkg-sdist[/\\]pkg-1\.0\.0\.tar\.gz$/),
    );
  });

  it('leaves the documented subdir layout untouched (no-op)', () => {
    // The target subdir already exists — nothing to relocate.
    existing('artifacts', 'pkg-sdist');

    normalizeArtifactLayout([SDIST_ROW], 'artifacts');

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('no-ops when the matrix expects multiple staged artifacts (only single-row case manifests the v8 dump)', () => {
    // Two expected artifacts — the multi-artifact code path on the action
    // side creates the right subdirs, so re-arranging in-process would be
    // actively harmful. The function bails before touching the fs.
    existing('artifacts');
    dumped('stray.txt');

    normalizeArtifactLayout([SDIST_ROW, WHEEL_ROW], 'artifacts');

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('no-ops on a crates-only matrix (build job never uploads a crate artifact)', () => {
    existing('artifacts');
    dumped('whatever');

    normalizeArtifactLayout([CRATE_ROW], 'artifacts');

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('no-ops on a vanilla-npm-only matrix (publish job packages from source)', () => {
    existing('artifacts');
    dumped('whatever');

    normalizeArtifactLayout([VANILLA_NPM_ROW], 'artifacts');

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('no-ops when the artifacts root does not exist (no download happened)', () => {
    // Neither target subdir nor the root exist.
    existsMock.mockReturnValue(false);

    expect(() => normalizeArtifactLayout([SDIST_ROW], 'artifacts')).not.toThrow();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('no-ops on an empty artifacts root', () => {
    // Root present but nothing was dumped into it.
    existing('artifacts');
    dumped();

    normalizeArtifactLayout([SDIST_ROW], 'artifacts');

    expect(mkdirMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('moves multiple dumped files (a wheel and its .pyi stubs, sigfile, etc.) into the same subdir', () => {
    // download-artifact's single-artifact extraction dumps every file
    // the upstream upload-artifact step staged — preserve them all,
    // not just the headline `.tar.gz`/`.whl`.
    existing('artifacts');
    dumped('pkg-1.0.0-py3-none-any.whl', 'pkg-1.0.0-py3-none-any.whl.sigstore');

    normalizeArtifactLayout([WHEEL_ROW], 'artifacts');

    expect(mkdirMock).toHaveBeenCalledWith(
      expect.stringMatching(/artifacts[/\\]pkg-wheel-x86_64-unknown-linux-gnu$/),
      { recursive: true },
    );
    expect(renameMock).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringMatching(/artifacts[/\\]pkg-1\.0\.0-py3-none-any\.whl$/),
      expect.stringMatching(/pkg-wheel-x86_64-unknown-linux-gnu[/\\]pkg-1\.0\.0-py3-none-any\.whl$/),
    );
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringMatching(/artifacts[/\\]pkg-1\.0\.0-py3-none-any\.whl\.sigstore$/),
      expect.stringMatching(/pkg-wheel-x86_64-unknown-linux-gnu[/\\]pkg-1\.0\.0-py3-none-any\.whl\.sigstore$/),
    );
  });
});

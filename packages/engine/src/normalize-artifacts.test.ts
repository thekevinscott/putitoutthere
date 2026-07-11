/**
 * Unit tests for `normalizeArtifactLayout`.
 *
 * The integration story lives in
 * `test/integration/artifact-layout.integration.test.ts` (the failing
 * test that drove this module's creation per #311). These unit cases
 * cover the no-op branches and edge shapes the integration tier
 * doesn't exercise: multi-artifact plans, already-subdir layouts,
 * crates-only matrices, vanilla-npm matrices, and empty/missing
 * artifact roots.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeArtifactLayout } from './normalize-artifacts.js';
import type { MatrixRow } from './plan.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piot-normalize-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
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
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, 'pkg-1.0.0.tar.gz'), 'sdist-bytes');

    normalizeArtifactLayout([SDIST_ROW], artifacts);

    expect(existsSync(join(artifacts, 'pkg-sdist', 'pkg-1.0.0.tar.gz'))).toBe(true);
    expect(readFileSync(join(artifacts, 'pkg-sdist', 'pkg-1.0.0.tar.gz'), 'utf8')).toBe(
      'sdist-bytes',
    );
    // The dumped file no longer sits at the root.
    expect(readdirSync(artifacts)).toEqual(['pkg-sdist']);
  });

  it('leaves the documented subdir layout untouched (no-op)', () => {
    const artifacts = join(root, 'artifacts');
    const subdir = join(artifacts, 'pkg-sdist');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(subdir, 'pkg-1.0.0.tar.gz'), 'sdist-bytes');

    normalizeArtifactLayout([SDIST_ROW], artifacts);

    expect(existsSync(join(subdir, 'pkg-1.0.0.tar.gz'))).toBe(true);
    expect(readdirSync(artifacts)).toEqual(['pkg-sdist']);
  });

  it('no-ops when the matrix expects multiple staged artifacts (only single-row case manifests the v8 dump)', () => {
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, 'stray.txt'), 'x');

    normalizeArtifactLayout([SDIST_ROW, WHEEL_ROW], artifacts);

    // Nothing moved — the multi-artifact code path on the action side
    // creates the right subdirs, so re-arranging in-process would be
    // actively harmful.
    expect(readdirSync(artifacts)).toEqual(['stray.txt']);
  });

  it('no-ops on a crates-only matrix (build job never uploads a crate artifact)', () => {
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, 'whatever'), 'x');

    normalizeArtifactLayout([CRATE_ROW], artifacts);

    expect(readdirSync(artifacts)).toEqual(['whatever']);
  });

  it('no-ops on a vanilla-npm-only matrix (publish job packages from source)', () => {
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, 'whatever'), 'x');

    normalizeArtifactLayout([VANILLA_NPM_ROW], artifacts);

    expect(readdirSync(artifacts)).toEqual(['whatever']);
  });

  it('no-ops when the artifacts root does not exist (no download happened)', () => {
    const artifacts = join(root, 'artifacts'); // intentionally not mkdir'd

    expect(() => normalizeArtifactLayout([SDIST_ROW], artifacts)).not.toThrow();
    expect(existsSync(artifacts)).toBe(false);
  });

  it('no-ops on an empty artifacts root', () => {
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });

    normalizeArtifactLayout([SDIST_ROW], artifacts);

    expect(readdirSync(artifacts)).toEqual([]);
  });

  it('moves multiple dumped files (a wheel and its .pyi stubs, sigfile, etc.) into the same subdir', () => {
    // download-artifact's single-artifact extraction dumps every file
    // the upstream upload-artifact step staged — preserve them all,
    // not just the headline `.tar.gz`/`.whl`.
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, 'pkg-1.0.0-py3-none-any.whl'), 'wheel');
    writeFileSync(join(artifacts, 'pkg-1.0.0-py3-none-any.whl.sigstore'), 'sig');

    normalizeArtifactLayout([WHEEL_ROW], artifacts);

    const subdir = join(artifacts, WHEEL_ROW.artifact_name);
    expect(existsSync(join(subdir, 'pkg-1.0.0-py3-none-any.whl'))).toBe(true);
    expect(existsSync(join(subdir, 'pkg-1.0.0-py3-none-any.whl.sigstore'))).toBe(true);
    expect(readdirSync(artifacts)).toEqual([WHEEL_ROW.artifact_name]);
  });
});

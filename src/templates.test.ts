/**
 * Workflow-template shape tests. Verifies:
 * - Three-job shape (plan / build / publish) for both cadences.
 * - Build-step matrix keys exist for crates / pypi / npm.
 * - Scheduled variant uses a cron trigger, immediate uses push:main.
 * - Check workflow uses pull_request + dry_run=true.
 * - Round-trip: `init` writes a valid YAML tree that actionlint approves
 *   when actionlint is available on PATH (skipped otherwise).
 *
 * Issue #25. Plan: §9.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { init } from './init.js';
import { CHECK_YML, RELEASE_YML_IMMEDIATE, RELEASE_YML_SCHEDULED, releaseYml, TOML_SKELETON, tomlSkeleton } from './templates.js';

describe('release.yml.immediate', () => {
  it('has the three jobs plan / build / publish in order', () => {
    const y = RELEASE_YML_IMMEDIATE;
    const planIdx = y.indexOf('\n  plan:\n');
    const buildIdx = y.indexOf('\n  build:\n');
    const publishIdx = y.indexOf('\n  publish:\n');
    expect(planIdx).toBeGreaterThan(0);
    expect(buildIdx).toBeGreaterThan(planIdx);
    expect(publishIdx).toBeGreaterThan(buildIdx);
  });

  it('build job keys steps on matrix.kind for crates / pypi / npm', () => {
    const y = RELEASE_YML_IMMEDIATE;
    expect(y).toContain("matrix.kind == 'crates'");
    expect(y).toContain("matrix.kind == 'pypi'");
    expect(y).toContain("matrix.kind == 'npm'");
  });

  it('publish job sets id-token + contents write perms', () => {
    const y = RELEASE_YML_IMMEDIATE;
    expect(y).toMatch(/id-token:\s*write/);
    expect(y).toMatch(/contents:\s*write/);
  });

  it('uses push:main + workflow_dispatch triggers', () => {
    const y = RELEASE_YML_IMMEDIATE;
    expect(y).toMatch(/push:\s*\n\s+branches:\s*\[main\]/);
    expect(y).toContain('workflow_dispatch');
  });

  it('exposes release concurrency group', () => {
    expect(RELEASE_YML_IMMEDIATE).toContain('group: release');
  });

  it('build job uploads artifacts named by matrix.artifact_name', () => {
    const y = RELEASE_YML_IMMEDIATE;
    expect(y).toContain('actions/upload-artifact@v4');
    expect(y).toContain('${{ matrix.artifact_name }}');
    expect(y).toContain('${{ matrix.artifact_path }}');
  });

  it('publish job installs Python + twine (pypi handler shells out to twine — #205)', () => {
    const y = RELEASE_YML_IMMEDIATE;
    expect(y).toMatch(/actions\/setup-python@v5/);
    expect(y).toMatch(/pip install twine/);
  });

  it('publish job configures git committer identity (createTag uses git tag -a — #206)', () => {
    const y = RELEASE_YML_IMMEDIATE;
    expect(y).toMatch(/git config --global user\.name/);
    expect(y).toMatch(/git config --global user\.email/);
    // github-actions[bot] canonical noreply, not a random bot identity.
    expect(y).toContain('41898282+github-actions[bot]@users.noreply.github.com');
  });

  it('build + publish jobs run on Node 24 (#208)', () => {
    const y = RELEASE_YML_IMMEDIATE;
    expect(y).not.toContain("node-version: '20'");
    expect(y).toMatch(/node-version: '24'/);
  });

  it('build job emits a bundle_cli cargo-build + stage step guarded on matrix.bundle_cli.bin (#217)', () => {
    const y = RELEASE_YML_IMMEDIATE;
    // The step only runs for pypi wheel rows that declared bundle_cli.
    expect(y).toMatch(/matrix\.bundle_cli\.bin\s*!=\s*''/);
    expect(y).toMatch(/matrix\.target\s*!=\s*'sdist'/);
    // It compiles the CLI for matrix.target.
    expect(y).toMatch(/cargo build --release --bin/);
    // It stages the binary into matrix.path/matrix.bundle_cli.stage_to.
    expect(y).toContain('matrix.bundle_cli.stage_to');
    // And runs BEFORE the maturin build step (so maturin picks the
    // staged binary up as package data).
    const stageIdx = y.indexOf('Build + stage bundled CLI');
    const maturinIdx = y.indexOf('Build wheel (maturin)');
    expect(stageIdx).toBeGreaterThan(0);
    expect(maturinIdx).toBeGreaterThan(stageIdx);
  });
});

describe('release.yml.scheduled', () => {
  it('uses cron 0 2 * * * + workflow_dispatch', () => {
    const y = RELEASE_YML_SCHEDULED;
    expect(y).toContain("cron: '0 2 * * *'");
    expect(y).toContain('workflow_dispatch');
  });

  it('keeps the same three jobs', () => {
    const y = RELEASE_YML_SCHEDULED;
    expect(y).toContain('\n  plan:\n');
    expect(y).toContain('\n  build:\n');
    expect(y).toContain('\n  publish:\n');
  });

  it('does NOT have push:main', () => {
    expect(RELEASE_YML_SCHEDULED).not.toMatch(/push:\s*\n\s+branches:\s*\[main\]/);
  });
});

describe('putitoutthere-check.yml', () => {
  it('triggers on pull_request', () => {
    expect(CHECK_YML).toContain('pull_request');
  });

  it('passes dry_run=true and fail_on_error=true', () => {
    expect(CHECK_YML).toContain('dry_run: true');
    expect(CHECK_YML).toContain('fail_on_error: true');
  });
});

describe('releaseYml(cadence)', () => {
  it('returns immediate when cadence="immediate"', () => {
    expect(releaseYml('immediate')).toBe(RELEASE_YML_IMMEDIATE);
  });

  it('returns scheduled when cadence="scheduled"', () => {
    expect(releaseYml('scheduled')).toBe(RELEASE_YML_SCHEDULED);
  });
});

describe('init round-trip', () => {
  it('init --cadence=scheduled writes the scheduled release.yml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'init-sched-'));
    try {
      init({ cwd: dir, cadence: 'scheduled' });
      const y = readFileSync(join(dir, '.github', 'workflows', 'release.yml'), 'utf8');
      expect(y).toContain("cron: '0 2 * * *'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('written workflows pass actionlint (skipped when actionlint unavailable)', () => {
    const probe = spawnSync('actionlint', ['--version'], { encoding: 'utf8' });
    /* v8 ignore next -- skipped unless actionlint is on PATH in CI */
    if (probe.error || probe.status !== 0) return;
    const dir = mkdtempSync(join(tmpdir(), 'init-actionlint-'));
    try {
      init({ cwd: dir });
      const ran = spawnSync(
        'actionlint',
        [
          join(dir, '.github/workflows/release.yml'),
          join(dir, '.github/workflows/putitoutthere-check.yml'),
        ],
        { encoding: 'utf8' },
      );
      /* v8 ignore next 3 -- actionlint presence varies across environments */
      if (ran.status !== 0) {
        throw new Error(`actionlint failed:\n${ran.stdout}\n${ran.stderr}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('tomlSkeleton(seeds) (#204)', () => {
  it('returns the bare skeleton when seeds is null or tag_format is omitted', () => {
    expect(tomlSkeleton()).toBe(TOML_SKELETON);
    expect(tomlSkeleton(null)).toBe(TOML_SKELETON);
    expect(tomlSkeleton({})).toBe(TOML_SKELETON);
  });

  it('prepends a banner that explains why + includes the suggested tag_format', () => {
    const out = tomlSkeleton({
      tag_format: 'v{version}',
      tag_format_reason: 'existing v*-style tag history (v0.1.0, v0.2.0)',
    });
    expect(out).toContain('piot init detected existing v*-style tag history (v0.1.0, v0.2.0)');
    expect(out).toContain('tag_format = "v{version}"');
    expect(out.endsWith(TOML_SKELETON)).toBe(true);
  });

  it('falls back to a generic reason phrase when tag_format_reason is omitted', () => {
    const out = tomlSkeleton({ tag_format: 'v{version}' });
    expect(out).toContain('piot init detected single-package repo');
  });
});

describe('TOML_SKELETON polyglot examples (#132)', () => {
  it('includes a crates example', () => {
    expect(TOML_SKELETON).toContain('kind = "crates"');
    expect(TOML_SKELETON).toMatch(/# path = "crates\/[^"]+"/);
  });

  it('crates example uses `**/Cargo.{toml,lock}` so nested workspace manifests cascade (#194)', () => {
    // Cascade paths are root-anchored (minimatch matchBase: false). A bare
    // "Cargo.toml" in the skeleton silently misses nested
    // packages/*/Cargo.toml in a workspace layout; the `**/` prefix is the
    // pattern docs/guide/cascade.md already recommends.
    expect(TOML_SKELETON).toContain('"**/Cargo.toml"');
    expect(TOML_SKELETON).toContain('"**/Cargo.lock"');
    // Make sure we didn't leave an unanchored `Cargo.toml` entry behind.
    expect(TOML_SKELETON).not.toMatch(/,\s*"Cargo\.toml"/);
    expect(TOML_SKELETON).not.toMatch(/,\s*"Cargo\.lock"/);
  });

  it('includes a pypi example with a pyproject.toml path hint', () => {
    expect(TOML_SKELETON).toContain('kind = "pypi"');
    expect(TOML_SKELETON).toMatch(/# path = "py\/[^"]+"/);
  });

  it('includes an npm example with a package.json path hint', () => {
    expect(TOML_SKELETON).toContain('kind = "npm"');
    expect(TOML_SKELETON).toMatch(/# path = "packages\/[^"]+"/);
  });
});

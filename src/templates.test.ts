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
import { CHECK_YML, RELEASE_YML_IMMEDIATE, RELEASE_YML_SCHEDULED, releaseYml, TOML_SKELETON } from './templates.js';

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

describe('TOML_SKELETON polyglot examples (#132)', () => {
  it('includes a crates example', () => {
    expect(TOML_SKELETON).toContain('kind = "crates"');
    expect(TOML_SKELETON).toMatch(/# path = "crates\/[^"]+"/);
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

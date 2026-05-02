/**
 * Workflow YAML invariant checks. Catches the @v1-typo class of bug
 * (#243) without the trusted-publisher overhead of a live workflow
 * self-test (#244).
 *
 * Asserts:
 * - Every inner `uses: thekevinscott/putitoutthere*` ref pins `@v0`.
 * - Every external `uses:` ref pins a major (`@v4`, ...) or full SHA.
 * - Every `uses: ./...` local-path ref resolves to an existing file.
 * - The reusable workflow's path matches the README + CHANGELOG.
 *
 * Issue #246.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const workflowsDir = join(repoRoot, '.github/workflows');

interface UsesRef {
  workflow: string;
  line: number;
  ref: string;
}

function collectUses(): UsesRef[] {
  const out: UsesRef[] = [];
  for (const name of readdirSync(workflowsDir)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const text = readFileSync(join(workflowsDir, name), 'utf8');
    text.split('\n').forEach((raw, idx) => {
      if (raw.trimStart().startsWith('#')) return;
      const stripped = raw.replace(/\s+#.*$/, '');
      const m = stripped.match(/^\s*-?\s*uses:\s+['"]?([^'"\s]+)['"]?/);
      if (!m) return;
      out.push({ workflow: name, line: idx + 1, ref: m[1]! });
    });
  }
  return out;
}

const refs = collectUses();

describe('#246 workflow YAML invariants', () => {
  it('collects at least one uses ref (parser sanity)', () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it('every inner thekevinscott/putitoutthere ref pins @v0', () => {
    const inner = refs.filter((r) => r.ref.startsWith('thekevinscott/putitoutthere'));
    expect(inner.length).toBeGreaterThan(0);
    const bad = inner.filter(
      (r) => !/^thekevinscott\/putitoutthere(?:\/[^@]+)?@v0$/.test(r.ref),
    );
    expect(
      bad,
      `inner refs must pin @v0:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every external uses ref pins a major, full SHA, or vendor-recommended branch', () => {
    const external = refs.filter(
      (r) =>
        r.ref.includes('/') &&
        !r.ref.startsWith('./') &&
        !r.ref.startsWith('thekevinscott/putitoutthere'),
    );
    expect(external.length).toBeGreaterThan(0);
    const bad = external.filter((r) => {
      const at = r.ref.lastIndexOf('@');
      if (at <= 0) return true;
      const tag = r.ref.slice(at + 1);
      // Accept:
      //  - `vN`, `vN.M`, `vN.M.P` major-pinned tags
      //  - 40-char full SHA
      //  - `release/vN` — PyPA publishes `pypa/gh-action-pypi-publish` against
      //    a `release/vN` branch as their recommended pinning; specific tags
      //    miss security patches that PyPA back-applies to the branch. The
      //    branch is the upstream-blessed pin, even though it isn't a tag.
      return (
        !/^v\d+(?:\.\d+){0,2}$/.test(tag) &&
        !/^[0-9a-f]{40}$/.test(tag) &&
        !/^release\/v\d+$/.test(tag)
      );
    });
    expect(
      bad,
      `external refs must pin a major (@vN), full SHA, or release/vN branch:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every local-path uses ref resolves to a file in the repo', () => {
    const local = refs.filter((r) => r.ref.startsWith('./'));
    const bad = local.filter((r) => {
      const path = r.ref.split('@')[0]!;
      return !existsSync(join(repoRoot, path));
    });
    expect(
      bad,
      `local-path refs must point at an existing file:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('reusable workflow path matches README and CHANGELOG examples', () => {
    expect(existsSync(join(repoRoot, '.github/workflows/release.yml'))).toBe(true);
    const expected = 'thekevinscott/putitoutthere/.github/workflows/release.yml@v0';
    expect(readFileSync(join(repoRoot, 'README.md'), 'utf8')).toContain(expected);
    expect(readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')).toContain(expected);
  });

  // The publish step throws PIOT_PUBLISH_EMPTY_PLAN when reached with an
  // empty matrix; the gate is what keeps `release: skip` (and any other
  // empty-plan reason) from running publish to a non-zero exit. Lock the
  // gate's presence in so a future edit can't quietly delete it and turn
  // every skip-trailer commit into a red release run.
  //
  // The gate's `needs.<job>.outputs.matrix` reference depends on which
  // job exposes the matrix in the file under test:
  // - `release.yml` delegates plan + build to `_matrix.yml`; the publish
  //   job reads `needs.build.outputs.matrix` from the reusable-workflow
  //   caller.
  // - `release-npm.yml` keeps an inline plan job; the publish job reads
  //   `needs.plan.outputs.matrix`.
  it.each([
    [
      '.github/workflows/release.yml',
      "if: fromJSON(needs.build.outputs.matrix || '[]')[0] != null",
    ],
    [
      '.github/workflows/release-npm.yml',
      "if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null",
    ],
  ])('%s gates the publish job on a non-empty matrix', (path, gate) => {
    const text = readFileSync(join(repoRoot, path), 'utf8');
    expect(text).toContain(gate);
  });
});

// #276: every PyO3/maturin-action invocation in `_matrix.yml`'s build job
// must be preceded by a step that bumps the package's version source to
// `${{ matrix.version }}`. Without this, maturin reads whatever literal
// is on disk in pyproject.toml and ships wheels at the stale version
// — the registered package fails to upload because PyPI rejects
// duplicate filenames.
//
// Other build paths bump elsewhere:
//  - crates: writeVersion runs at publish.
//  - npm:    writeVersion runs at publish.
//  - pypi (setuptools-scm/hatch-vcs): SETUPTOOLS_SCM_PRETEND_VERSION env.
// Maturin is the only build path where the artifact (wheel) leaves the
// build runner pre-versioned, so the bump must happen here, before the
// maturin call. See #276.
describe('#276 _matrix.yml maturin pre-build version bump', () => {
  interface Step {
    if?: string;
    uses?: string;
    with?: Record<string, unknown>;
  }
  interface MatrixYaml {
    jobs?: { build?: { steps?: Step[] } };
  }

  const matrixPath = join(repoRoot, '.github/workflows/_matrix.yml');
  const matrix = parseYaml(readFileSync(matrixPath, 'utf8')) as MatrixYaml;
  const buildSteps: Step[] = matrix.jobs?.build?.steps ?? [];

  function isMaturinStep(step: Step): boolean {
    return typeof step.uses === 'string' && step.uses.startsWith('PyO3/maturin-action');
  }

  function isVersionBumpStep(step: Step): boolean {
    if (!step.with) return false;
    const w = step.with as Record<string, unknown>;
    if (w.command !== 'write-version') return false;
    const version = typeof w.version === 'string' ? w.version : '';
    return version.includes('matrix.version');
  }

  it('build job has at least one maturin step (parser sanity)', () => {
    const maturinSteps = buildSteps.filter(isMaturinStep);
    expect(maturinSteps.length).toBeGreaterThan(0);
  });

  it('every maturin invocation is preceded by a write-version step gated on the same matrix conditions', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isMaturinStep(step)) return;
      const earlier = buildSteps.slice(0, idx);
      const matchingBump = earlier.find(
        (s) =>
          isVersionBumpStep(s) &&
          // The bump step must gate on matrix.kind == 'pypi' AND
          // matrix.build == 'maturin' so it doesn't run for non-maturin
          // pypi rows (where SETUPTOOLS_SCM_PRETEND_VERSION already
          // handles the bump) or for any non-pypi row.
          typeof s.if === 'string' &&
          s.if.includes("matrix.kind == 'pypi'") &&
          s.if.includes("matrix.build == 'maturin'"),
      );
      if (!matchingBump) {
        offenders.push(
          `step #${idx} (uses=${step.uses}, if=${step.if ?? '(none)'}) has no preceding write-version bump step`,
        );
      }
    });
    expect(
      offenders,
      `every maturin step must be preceded by a write-version bump:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

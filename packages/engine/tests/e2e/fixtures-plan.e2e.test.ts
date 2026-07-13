/**
 * Fixture plan snapshot tests. For each fixture, initialize a git
 * repo from the source tree, call `plan()`, and assert the matrix
 * shape matches expectations.
 *
 * Exercises:
 * - #29 pure-language shapes (1 row per package, no targets).
 * - #30 rust-in-language shapes (5 target rows + sdist / main).
 * - #31 polyglot cascades (depends_on transitivity).
 *
 * Not a byte-identical snapshot — we assert *shape*, which is what
 * changes when the plan logic breaks. Byte-identical snapshots are
 * brittle across version bumps.
 *
 * Issues #29, #30, #31.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run as runCli } from '../../src/cli.js';
import { plan } from '../../src/plan.js';

// The fixture data (sample consumer repos) lives at `test/fixtures/`, shared
// with the e2e-fixture-job.yml publish harness; this test consumes it from
// there rather than owning it.
const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'test', 'fixtures');

let repo: string;

beforeEach(() => {
  repo = '';
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function prepareFixture(name: string): string {
  repo = mkdtempSync(join(tmpdir(), `fixture-${name}-`));
  cpSync(join(FIXTURES_DIR, name), repo, { recursive: true });
  rewritePlaceholders(repo, '0.1.0');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: repo });
  return repo;
}

function rewritePlaceholders(root: string, version: string): void {
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        walk(p);
        continue;
      }
      if (entry.name === 'README.md') continue;
      try {
        const s = readFileSync(p, 'utf8');
        if (s.includes('__VERSION__')) writeFileSync(p, s.replaceAll('__VERSION__', version), 'utf8');
      } catch {
        // Binary or unreadable; skip.
      }
    }
  };
  walk(root);
}

describe('#29 pure-language fixtures', () => {
  it('python-pure-hatch → 1 pypi sdist + 1 pypi wheel-any row (#324)', async () => {
    const cwd = prepareFixture('python-pure-hatch');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'pypi')).toBe(true);
    expect(rows.map((r) => r.target).sort()).toEqual(['any', 'sdist']);
  });

  it('python-pure-sdist-only → 1 pypi sdist row', async () => {
    const cwd = prepareFixture('python-pure-sdist-only');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(1);
  });

  it('js-vanilla → 1 npm noarch row', async () => {
    const cwd = prepareFixture('js-vanilla');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('npm');
    expect(rows[0]!.target).toBe('noarch');
  });

  // #334: rust-vanilla-first-publish exercises the
  // `PIOT_CRATES_REGISTRY_PRIMARY` engine seam end-to-end (the crates
  // analogue of #315's js-vanilla-first-publish for npm). The plan
  // shape is the same as a steady-state vanilla crates fixture: a
  // single crates row, no targets. This unit-tier assertion keeps the
  // fixture's plan contract observable independently of the e2e job
  // that publishes against the in-job alt-registry.
  it('rust-vanilla-first-publish → 1 crates row', async () => {
    const cwd = prepareFixture('rust-vanilla-first-publish');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('crates');
  });
});

describe('#30 rust-in-language fixtures', () => {
  it('python-rust-maturin → 5 wheels + 1 sdist', async () => {
    const cwd = prepareFixture('python-rust-maturin');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'sdist')).toHaveLength(1);
    expect(rows.filter((r) => r.target !== 'sdist')).toHaveLength(5);
  });

  it('js-napi → 5 platform rows + 1 main', async () => {
    const cwd = prepareFixture('js-napi');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'main')).toHaveLength(1);
  });

  it('js-bundled-cli → 5 platform rows + 1 main', async () => {
    const cwd = prepareFixture('js-bundled-cli');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'main')).toHaveLength(1);
  });

  // #305: js-bundled-cli-first-publish is the first-publish variant
  // of js-bundled-cli. Same plan shape (the fixture's contribution is
  // a deliberately-stale pnpm-lock.yaml that exercises the #288
  // fallback in CI, not a different plan). Plan-shape assertion lives
  // here so any drift in row count surfaces at the unit tier; the
  // lockfile-drift recovery is e2e-tier (see e2e-fixture-job.yml).
  it('js-bundled-cli-first-publish → 5 platform rows + 1 main (#288 repro fixture)', async () => {
    const cwd = prepareFixture('js-bundled-cli-first-publish');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'main')).toHaveLength(1);
  });

  // #306: js-napi-first-publish is the first-publish variant of js-napi.
  // Same plan shape — the fixture's contribution is publishing against
  // an empty Verdaccio where per-triple platform packages 404 before
  // the main package's optionalDependencies are uploaded. The
  // npm-platform handler's publish-ordering logic (per-triple first,
  // then rewrite main's optionalDependencies, then publish main) is
  // the only thing that keeps this working; this fixture is the e2e
  // coverage of that ordering. Plan-shape assertion lives here so any
  // drift in row count surfaces at the unit tier; the empty-registry
  // publish-ordering behavior is e2e-tier (see e2e-fixture-job.yml).
  it('js-napi-first-publish → 5 platform rows + 1 main', async () => {
    const cwd = prepareFixture('js-napi-first-publish');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'main')).toHaveLength(1);
  });
});

// #276: artifact-version vs plan-version contract for the build phase.
//
// The bug class: the build job produces an artifact whose embedded
// version disagrees with `matrix.version`. We hit this on maturin —
// wheels shipped at the literal pyproject.toml version regardless of
// what plan computed. The same shape could open up in any build path.
//
// This is the unit-tier check: against each fixture, confirm the
// version-source manifest the build phase would read carries the
// planned version *after* running the bump that the build phase is
// responsible for. Doesn't run maturin / cargo / npm itself; that's
// the e2e tier (`.github/workflows/e2e-fixture-job.yml`). What it
// does cover is the contract that the bump exists, targets the right
// file, and produces the expected on-disk state.
describe('#276 build-phase version bump bumps the manifest the build tool reads', () => {
  it('python-rust-maturin → Cargo.toml carries the planned version, pyproject is unchanged', async () => {
    // After #333, every pypi pyproject declares `dynamic = ["version"]`
    // and the version source moves to Cargo.toml. The bump must
    // follow.
    const cwd = prepareFixture('python-rust-maturin');
    const pyPath = join(cwd, 'pyproject.toml');
    const pyBefore = readFileSync(pyPath, 'utf8');
    expect(pyBefore).toContain('dynamic = ["version"]');

    const code = await runCli([
      'node',
      'putitoutthere',
      'write-version',
      '--path',
      cwd,
      '--version',
      '9.9.9',
    ]);
    expect(code).toBe(0);

    expect(readFileSync(join(cwd, 'Cargo.toml'), 'utf8')).toContain('version = "9.9.9"');
    // pyproject is the dispatch input only; its content must not change
    // on the dynamic-version path.
    expect(readFileSync(pyPath, 'utf8')).toBe(pyBefore);
  });
});

describe('#31 polyglot fixtures', () => {
  it('js-python-no-rust → 2 pypi (sdist + wheel-any) + 1 npm noarch', async () => {
    const cwd = prepareFixture('js-python-no-rust');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(3);
    const byKind = new Map<string, number>();
    for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    expect(byKind.get('pypi')).toBe(2);
    expect(byKind.get('npm')).toBe(1);
  });

  // #308: first-publish variant of js-python-no-rust. Same plan shape
  // as the steady-state fixture (the variant's contribution is the
  // npm-side first-publish path against per-job Verdaccio plus a
  // distinct python package name, not a different plan). Plan-shape
  // assertion lives here so any drift in row count surfaces at the
  // unit tier; the publish-path behavior is e2e-tier (see
  // e2e-fixture-job.yml).
  it('js-python-no-rust-first-publish → 2 pypi (sdist + wheel-any) + 1 npm noarch', async () => {
    const cwd = prepareFixture('js-python-no-rust-first-publish');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(3);
    const byKind = new Map<string, number>();
    for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    expect(byKind.get('pypi')).toBe(2);
    expect(byKind.get('npm')).toBe(1);
  });

  it('polyglot-everything → rust + python (5+sdist) + multi-mode npm (5+5+main)', async () => {
    const cwd = prepareFixture('polyglot-everything');
    const rows = await plan({ cwd });
    // 1 rust + 6 python + 11 npm (2 modes × 5 triples + 1 main) = 18 rows.
    expect(rows).toHaveLength(18);
    const byName = new Map<string, number>();
    for (const r of rows) byName.set(r.name, (byName.get(r.name) ?? 0) + 1);
    expect(byName.get('piot-fixture-zzz-poly-rust')).toBe(1);
    expect(byName.get('piot-fixture-zzz-python')).toBe(6);
    expect(byName.get('@putitoutthere/piot-fixture-zzz-cli')).toBe(11);
    // Multi-mode rows split by build: 5 napi + 5 bundled-cli + 1 main.
    const npmRows = rows.filter((r) => r.name === '@putitoutthere/piot-fixture-zzz-cli');
    expect(npmRows.filter((r) => r.build === 'napi' && r.target !== 'main')).toHaveLength(5);
    expect(npmRows.filter((r) => r.build === 'bundled-cli' && r.target !== 'main')).toHaveLength(5);
    expect(npmRows.filter((r) => r.target === 'main')).toHaveLength(1);
    // Multi-mode artifact names carry the mode infix.
    const napiLinux = npmRows.find(
      (r) => r.build === 'napi' && r.target === 'x86_64-unknown-linux-gnu',
    )!;
    expect(napiLinux.artifact_name).toBe(
      '@putitoutthere__piot-fixture-zzz-cli-napi-x86_64-unknown-linux-gnu',
    );
  });
});

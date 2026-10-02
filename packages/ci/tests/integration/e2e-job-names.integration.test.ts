/**
 * Integration test for the e2e fixture lane's check names (#655).
 *
 * Mocks nothing. It reads the real `.github/workflows/e2e-fixture-job.yml`,
 * pulls the real `name:` templates out of it, and renders them over rows the
 * real `plan()` computed from the real fixture trees — the same composition
 * `e2e-fixture-job.yml`'s `plan` job performs. A mocked workflow or a
 * hand-written matrix would only prove the templates agree with the shape
 * this file assumed, which is the self-consistency trap the issue is about:
 * the names that shipped before #655 were self-consistent too, and still
 * unusable.
 *
 * Three claims, none of which a reviewer reading a `name:` diff can check:
 *
 *  1. `build` declares a name at all. Without one GitHub renders the whole
 *     matrix row, and two of its fields are stamped per run on purpose (a
 *     `0.0.<unix_seconds>` version, a `github.run_id`-uniquified package
 *     name). Deleting the `name:` is a one-line, innocuous-looking diff.
 *  2. The name is composed only of slots a predictor can substitute, and
 *     depends on no run-scoped field. `artifact_path` is stable (it derives
 *     from `[[package]].path`); the one-character-different `artifact_name`
 *     is not (it derives from `[[package]].name`). Nothing in a diff
 *     distinguishes them.
 *  3. The name is injective over the rows `plan()` can emit — not merely
 *     over the rows today's fixtures happen to emit. Two live jobs reporting
 *     under one check name is silent: the check list just gets shorter.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { plan, type MatrixRow } from 'putitoutthere';

import { parseJobNameTemplates } from '../../src/e2e-job-names/parse-job-name-templates.js';
import { renderJobName } from '../../src/e2e-job-names/render-job-name.js';
import { listFixtures } from '../../src/fixture-matrix/list-fixtures.js';
import { materializeFixtureForMatrix } from '../../src/fixture-matrix/materialize-fixture.js';
import { execInherit } from '../../src/utils/exec-inherit.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const WORKFLOW = join(REPO_ROOT, '.github/workflows/e2e-fixture-job.yml');
const FIXTURES_ROOT = join(REPO_ROOT, 'packages/engine/tests/fixtures');

const templates = parseJobNameTemplates(await readFile(WORKFLOW, 'utf8'));
const buildTemplate = templates.get('build');

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function track(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

/** The `build` check name every row of `rows` would dispatch under. */
function buildNames(rows: readonly MatrixRow[]): string[] {
  if (typeof buildTemplate !== 'string') {
    throw new Error('e2e-fixture-job.yml: the `build` job declares no `name:`');
  }
  return rows.map((row) => renderJobName(buildTemplate, row));
}

/** Names that more than one row in `rows` would report under. */
function collidingNames(rows: readonly MatrixRow[]): string[] {
  const counts = new Map<string, number>();
  for (const name of buildNames(rows)) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([name]) => name);
}

async function planFixture(fixture: string): Promise<MatrixRow[]> {
  return plan({ cwd: track(await materializeFixtureForMatrix(FIXTURES_ROOT, fixture)) });
}

/**
 * A maturin package whose wheel build fans across two CPython versions: a
 * pyo3 extension with no `abi3` feature (so `isVersionIndependentWheel` does
 * not collapse the fan) plus an explicit `python_versions` pair. Real config,
 * real planner — the resulting wheel rows differ from each other in
 * `python_version` and in nothing else a run-stable name could read.
 *
 * No e2e fixture has this shape today: every maturin fixture enables
 * `pyo3/abi3-py38`. That is why the collision is latent rather than live, and
 * why asserting injectivity over only the current fixtures would not catch
 * it. `python_versions` is documented `putitoutthere.toml` surface, and the
 * same fan arrives automatically from a `requires-python` spanning two
 * versions, so this is one config edit away in either direction.
 */
async function planCPythonFan(): Promise<MatrixRow[]> {
  const dir = track(await mkdtemp(join(tmpdir(), 'piot-e2e-job-names-fan-')));
  await writeFile(
    join(dir, 'putitoutthere.toml'),
    [
      '[putitoutthere]',
      'version = 1',
      '',
      '[[package]]',
      'name = "fanned"',
      'kind = "pypi"',
      'path = "."',
      'globs = ["src/**", "Cargo.toml", "pyproject.toml"]',
      'build = "maturin"',
      'python_versions = ["3.11", "3.12"]',
      'targets = ["x86_64-unknown-linux-gnu"]',
      'first_version = "0.1.0"',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'pyproject.toml'),
    [
      '[build-system]',
      'requires = ["maturin>=1"]',
      'build-backend = "maturin"',
      '',
      '[project]',
      'name = "fanned"',
      'dynamic = ["version"]',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(dir, 'Cargo.toml'),
    [
      '[package]',
      'name = "fanned"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[lib]',
      'name = "fanned"',
      'crate-type = ["cdylib"]',
      '',
      '# No abi3 feature, so the wheel is CPython-version-specific and the',
      '# planner fans it across the resolved interpreter set.',
      '[dependencies]',
      'pyo3 = { version = "0.22", features = ["extension-module"] }',
      '',
    ].join('\n'),
  );
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'lib.rs'), '');
  // Mirrors materializeFixtureForMatrix: a throwaway repo with a HEAD commit
  // and no tags, which is the first-release path `plan()` takes.
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['config', 'user.email', 'e2e@putitoutthere.dev'],
    ['config', 'user.name', 'piot e2e'],
    ['config', 'commit.gpgsign', 'false'],
    ['add', '.'],
    ['commit', '-q', '-m', 'e2e: initial fixture'],
  ]) {
    await execInherit('git', args, { cwd: dir });
  }
  return plan({ cwd: dir });
}

describe('e2e-fixture-job.yml check names (integration)', () => {
  it('declares an explicit name: on build, so GitHub does not render the matrix row', () => {
    expect(templates.get('build')).toEqual(expect.any(String));
  });

  // Measured in #660, and pinned here rather than left to judgement:
  // `name: publish (${{ inputs.fixture }})` renders fine on GitHub, but
  // willfire does not propagate a caller's matrix into a called workflow's
  // `inputs` context — so it turned 15 statically-resolvable checks into 15
  // unresolvable ones, against the exact tool #655 was filed for. Neither
  // job is a matrix job, so GitHub already derives a stable check name from
  // the job id, and `e2e-fixture.yml` supplies the fixture through its own
  // `name: e2e (${{ matrix.fixture }})`. Naming them buys nothing and costs
  // that.
  it('leaves the non-matrix jobs unnamed, where GitHub already derives a stable name from the job id', () => {
    expect([...templates].filter(([, template]) => template === null).map(([id]) => id)).toEqual([
      'plan',
      'publish',
    ]);
  });

  it(
    'builds the name from slots a check-name predictor can substitute, with no expression to evaluate',
    { timeout: 30_000 },
    async () => {
      const rows = await planFixture('polyglot-everything');

      expect(rows.length).toBeGreaterThan(0);
      // renderJobName throws on anything that is not a bare `matrix.<path>`.
      expect(buildNames(rows).every((name) => name.length > 0)).toBe(true);
    },
  );

  it(
    'renders a name that does not move when the fixture materializer restamps the run-scoped fields',
    { timeout: 30_000 },
    async () => {
      const rows = await planFixture('polyglot-everything-first-publish');

      // The two stamps `fixture-materialize` applies per run (see
      // packages/ci/src/fixture-materialize/decide.ts): `__VERSION__` becomes
      // `0.0.<unix_seconds>`, and a `-placeholder` suffix is uniquified with
      // RUN_ID / RUN_ATTEMPT — which flows into `artifact_name` as well.
      const restamped = rows.map((row) => ({
        ...row,
        version: '0.0.1788205971',
        name: `${row.name}-77-3`,
        artifact_name: `${row.artifact_name}-77-3`,
      }));

      expect(restamped).not.toEqual(rows);
      expect(buildNames(restamped)).toEqual(buildNames(rows));
    },
  );

  it(
    'gives every planned row of every declared fixture its own check name',
    { timeout: 180_000 },
    async () => {
      const fixtures = await listFixtures(FIXTURES_ROOT);
      expect(fixtures.length).toBeGreaterThan(0);

      let planned = 0;
      for (const fixture of fixtures) {
        const rows = await planFixture(fixture);
        planned += rows.length;
        expect(collidingNames(rows), `${fixture}: two build jobs share a check name`).toEqual([]);
      }
      expect(planned).toBeGreaterThan(0);
    },
  );

  it(
    'keeps the names distinct when a maturin wheel build fans across CPython versions',
    { timeout: 30_000 },
    async () => {
      const rows = await planCPythonFan();

      // Non-vacuity: the planner really did fan, and it disambiguated its own
      // artifacts across the fan. The check name has to do the same.
      expect(
        rows
          .filter((row) => row.target === 'x86_64-unknown-linux-gnu')
          .map((row) => row.python_version),
      ).toEqual(['3.11', '3.12']);
      expect(new Set(rows.map((row) => row.artifact_name)).size).toBe(rows.length);

      expect(collidingNames(rows)).toEqual([]);
    },
  );
});

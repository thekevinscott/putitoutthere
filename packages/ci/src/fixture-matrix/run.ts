/**
 * Composition root for the fixture-matrix gate (#670): resolve the fixture
 * argument, materialize it into a throwaway repo, and hand it to the real
 * `plan()` — the same function the reusable workflow's `plan` job calls —
 * so a fixture's matrix can be inspected without a GitHub Actions run.
 * Design-commitments non-goal #7: a thin reader over the release path's own
 * function, never a parallel reimplementation of matrix logic.
 */

import { readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { plan } from 'putitoutthere';

import { buildFixtureMatrixDocument } from './build-document.js';
import { decideFixtureMatrix } from './decide.js';
import { materializeFixtureForMatrix } from './materialize-fixture.js';

// Resolved from this module's own location, not process.cwd() — pnpm runs
// this package's scripts (and its tests) with cwd set to packages/ci/, not
// the repo root.
const FIXTURES_ROOT = fileURLToPath(new URL('../../../engine/tests/fixtures', import.meta.url));

async function listFixtures(): Promise<string[]> {
  const entries = await readdir(FIXTURES_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function runFixtureMatrix(argv: readonly string[]): Promise<number> {
  const decision = decideFixtureMatrix({
    fixtureArg: argv[3],
    availableFixtures: await listFixtures(),
  });
  if (!decision.ok) {
    process.stderr.write(`piot-ci fixture-matrix: ${decision.reason}\n`);
    return 1;
  }

  const dir = await materializeFixtureForMatrix(FIXTURES_ROOT, decision.fixture);
  try {
    const matrix = await plan({ cwd: dir });
    const doc = buildFixtureMatrixDocument(decision.fixture, matrix);
    process.stdout.write(`${JSON.stringify(doc)}\n`);
    return 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

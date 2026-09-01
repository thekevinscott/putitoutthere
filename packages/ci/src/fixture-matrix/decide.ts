/**
 * Decision core for the fixture-matrix gate (#670). I/O-free: given the
 * fixture argv and the fixture names actually present on disk, decide
 * whether the run proceeds and which fixture to materialize. Extracted so
 * the three failure messages (missing arg, unknown fixture, non-directory
 * fixtures-root entry) are pinned independent of how `run.ts` gathers
 * `availableFixtures`.
 */

export const FIXTURES_ROOT_LABEL = 'packages/engine/tests/fixtures';

export interface DecideFixtureMatrixInput {
  fixtureArg: string | undefined;
  availableFixtures: readonly string[];
}

export type DecideFixtureMatrixResult =
  | { ok: true; fixture: string }
  | { ok: false; reason: string };

export function decideFixtureMatrix(input: DecideFixtureMatrixInput): DecideFixtureMatrixResult {
  const { fixtureArg, availableFixtures } = input;
  if (fixtureArg === undefined || fixtureArg === '') {
    return { ok: false, reason: 'a fixture name is required (usage: piot-ci fixture-matrix <fixture>)' };
  }
  if (!availableFixtures.includes(fixtureArg)) {
    return { ok: false, reason: `no fixture named '${fixtureArg}' under ${FIXTURES_ROOT_LABEL}` };
  }
  return { ok: true, fixture: fixtureArg };
}

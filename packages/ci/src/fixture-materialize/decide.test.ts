/**
 * Decision matrix for the fixture-materialize harness (#447), extracted from the
 * three "Materialize fixture" bash blocks in `e2e-fixture-job.yml`. Pins the
 * exact per-phase substitution list, git-init flag, and FIXTURE_VERSION-export
 * flag so the TypeScript reimplementation is provably equivalent. Pure — no I/O.
 * Assertions are exact (`toEqual` on the whole plan) so a dropped or altered
 * substitution or flag is caught.
 */

import { describe, expect, it } from 'vitest';

import { decideFixtureMaterialize, type FixtureMaterializeInput } from './decide.js';

const base: Omit<FixtureMaterializeInput, 'mode'> = {
  fixture: 'js-vanilla',
  version: '0.0.42',
  runId: '111',
  runAttempt: '2',
};

describe('decideFixtureMaterialize: plan phase', () => {
  it('substitutes __VERSION__, git-inits, and exports FIXTURE_VERSION (steady-state)', () => {
    expect(decideFixtureMaterialize({ ...base, mode: 'plan' })).toEqual({
      substitutions: [{ from: '__VERSION__', to: '0.0.42' }],
      gitInit: true,
      writeFixtureVersion: true,
    });
  });

  it('adds the -placeholder → -RUN_ID-RUN_ATTEMPT rewrite on a first-publish fixture', () => {
    expect(decideFixtureMaterialize({ ...base, mode: 'plan', fixture: 'rust-vanilla-first-publish' })).toEqual({
      substitutions: [
        { from: '__VERSION__', to: '0.0.42' },
        { from: '-placeholder', to: '-111-2' },
      ],
      gitInit: true,
      writeFixtureVersion: true,
    });
  });
});

describe('decideFixtureMaterialize: build phase', () => {
  it('substitutes __VERSION__ only — no git, no export, no placeholder even on first-publish', () => {
    expect(decideFixtureMaterialize({ ...base, mode: 'build', fixture: 'js-napi-first-publish' })).toEqual({
      substitutions: [{ from: '__VERSION__', to: '0.0.42' }],
      gitInit: false,
      writeFixtureVersion: false,
    });
  });
});

describe('decideFixtureMaterialize: publish phase', () => {
  it('substitutes __VERSION__ and git-inits, but does NOT export FIXTURE_VERSION (steady-state)', () => {
    expect(decideFixtureMaterialize({ ...base, mode: 'publish' })).toEqual({
      substitutions: [{ from: '__VERSION__', to: '0.0.42' }],
      gitInit: true,
      writeFixtureVersion: false,
    });
  });

  it('adds the placeholder rewrite on a first-publish fixture', () => {
    expect(
      decideFixtureMaterialize({ ...base, mode: 'publish', fixture: 'polyglot-everything-first-publish' }),
    ).toEqual({
      substitutions: [
        { from: '__VERSION__', to: '0.0.42' },
        { from: '-placeholder', to: '-111-2' },
      ],
      gitInit: true,
      writeFixtureVersion: false,
    });
  });
});

describe('decideFixtureMaterialize: first-publish detection is a suffix match', () => {
  it('does not treat a fixture that merely contains "-first-publish" mid-name as first-publish', () => {
    const plan = decideFixtureMaterialize({ ...base, mode: 'plan', fixture: 'js-first-publish-extra' });
    expect(plan.substitutions).toEqual([{ from: '__VERSION__', to: '0.0.42' }]);
  });
});

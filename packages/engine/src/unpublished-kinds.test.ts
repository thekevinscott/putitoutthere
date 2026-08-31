/**
 * `unpublishedKinds` unit coverage (#622). Pure function over the verdicts
 * `plan` already computes, so there is no collaborator to mock. The
 * consequence of each case is a workflow `if:` — see the integration and e2e
 * twins for the whole path, and `test/workflows/crates-auth-unpublished-gate.test.ts`
 * for the wiring that carries the answer to the gate.
 */

import { describe, expect, it } from 'vitest';

import type { PlanVerdict } from './plan-status-types.js';
import type { Kind } from './types.js';
import { unpublishedKinds } from './unpublished-kinds.js';

const verdict = (
  pkg: string,
  kind: Kind,
  value: PlanVerdict['verdict'],
): PlanVerdict => ({ package: pkg, kind, version: '1.2.3', verdict: value });

describe('unpublishedKinds (#622)', () => {
  it('lists a kind whose version is not yet on the registry', () => {
    expect(unpublishedKinds([verdict('lib-rust', 'crates', 'publish')])).toEqual(['crates']);
  });

  it('drops a kind whose every version is already published', () => {
    // The #622 bug in one assertion: the repo still *has* a crate, so the
    // matrix still carries a crates row — but there is no crates.io work,
    // so the run must not require a crates.io credential to complete.
    expect(unpublishedKinds([verdict('lib-rust', 'crates', 'skip')])).toEqual([]);
  });

  it('keeps a kind listed when the registry read was UNKNOWN', () => {
    // Reading "we could not tell" as "nothing to do" would drop a
    // credential the publish may still need. Only `skip` — a positive
    // "already there" — removes a kind.
    expect(unpublishedKinds([verdict('lib-rust', 'crates', 'unknown')])).toEqual(['crates']);
  });

  it('keeps a kind when any one of its packages still has work', () => {
    expect(
      unpublishedKinds([
        verdict('lib-a', 'crates', 'skip'),
        verdict('lib-b', 'crates', 'publish'),
      ]),
    ).toEqual(['crates']);
  });

  it('drops only the fully-published kinds from a mixed plan (the #622 repro)', () => {
    // First run shipped the crate and died on npm; the re-run has npm work
    // and no crates work.
    expect(
      unpublishedKinds([
        verdict('lib-rust', 'crates', 'skip'),
        verdict('lib-js', 'npm', 'publish'),
        verdict('lib-py', 'pypi', 'skip'),
      ]),
    ).toEqual(['npm']);
  });

  it('reports each kind once, in first-seen order', () => {
    expect(
      unpublishedKinds([
        verdict('lib-js', 'npm', 'publish'),
        verdict('lib-rust', 'crates', 'publish'),
        verdict('lib-js-2', 'npm', 'publish'),
      ]),
    ).toEqual(['npm', 'crates']);
  });

  it('returns nothing for an empty verdict list', () => {
    expect(unpublishedKinds([])).toEqual([]);
  });
});

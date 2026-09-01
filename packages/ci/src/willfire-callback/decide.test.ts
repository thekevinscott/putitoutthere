/**
 * Decision core for the willfire-callback adapter (#681): validates the
 * WILLFIRE_* env contract willfire hands to a callback command before any
 * fixture materialization happens. Pure — the workflow-file existence
 * check is a fact `run.ts` gathers via I/O and passes in, so every guard
 * and its exact failure wording is pinned here independent of how `run.ts`
 * reads the environment or the filesystem.
 */

import { describe, expect, it } from 'vitest';

import { decideWillfireCallback } from './decide.js';

const VALID = {
  job: 'plan',
  workflow: '.github/workflows/e2e-fixture-job.yml',
  workflowRepo: 'thekevinscott/putitoutthere',
  workflowFileExists: true,
  inputsJson: '{"fixture":"js-vanilla","simulate_no_dist":"false"}',
};

describe('decideWillfireCallback: happy path', () => {
  it('extracts the fixture from WILLFIRE_INPUTS when every guard passes', () => {
    expect(decideWillfireCallback(VALID)).toEqual({ ok: true, fixture: 'js-vanilla' });
  });

  it('ignores unknown keys in WILLFIRE_INPUTS', () => {
    expect(
      decideWillfireCallback({ ...VALID, inputsJson: '{"fixture":"js-napi","some_other_key":"true"}' }),
    ).toEqual({ ok: true, fixture: 'js-napi' });
  });
});

describe('decideWillfireCallback: WILLFIRE_JOB', () => {
  it('rejects an unsupported job id', () => {
    expect(decideWillfireCallback({ ...VALID, job: 'build' })).toEqual({
      ok: false,
      reason: "willfire-callback: unsupported WILLFIRE_JOB 'build' (only 'plan' is supported)",
    });
  });

  it('rejects a missing job id', () => {
    expect(decideWillfireCallback({ ...VALID, job: undefined })).toEqual({
      ok: false,
      reason: "willfire-callback: unsupported WILLFIRE_JOB '<unset>' (only 'plan' is supported)",
    });
  });
});

describe('decideWillfireCallback: WILLFIRE_WORKFLOW', () => {
  it('rejects a workflow path that is not the fixture-matrix callee', () => {
    expect(decideWillfireCallback({ ...VALID, workflow: '.github/workflows/release.yml' })).toEqual({
      ok: false,
      reason:
        "willfire-callback: unexpected WILLFIRE_WORKFLOW '.github/workflows/release.yml' (expected '.github/workflows/e2e-fixture-job.yml')",
    });
  });

  it('rejects a missing workflow path', () => {
    expect(decideWillfireCallback({ ...VALID, workflow: undefined })).toEqual({
      ok: false,
      reason:
        "willfire-callback: unexpected WILLFIRE_WORKFLOW '<unset>' (expected '.github/workflows/e2e-fixture-job.yml')",
    });
  });

  it('fails closed when the expected workflow file is missing from the checkout, even with a matching path string', () => {
    expect(decideWillfireCallback({ ...VALID, workflowFileExists: false })).toEqual({
      ok: false,
      reason:
        "willfire-callback: expected workflow file '.github/workflows/e2e-fixture-job.yml' not found under the current checkout — layout mismatch",
    });
  });
});

describe('decideWillfireCallback: WILLFIRE_WORKFLOW_REPO', () => {
  it('rejects a cross-repo collision', () => {
    expect(decideWillfireCallback({ ...VALID, workflowRepo: 'someone-else/putitoutthere' })).toEqual({
      ok: false,
      reason:
        "willfire-callback: unexpected WILLFIRE_WORKFLOW_REPO 'someone-else/putitoutthere' (expected 'thekevinscott/putitoutthere')",
    });
  });

  it('rejects a missing workflow repo', () => {
    expect(decideWillfireCallback({ ...VALID, workflowRepo: undefined })).toEqual({
      ok: false,
      reason:
        "willfire-callback: unexpected WILLFIRE_WORKFLOW_REPO '<unset>' (expected 'thekevinscott/putitoutthere')",
    });
  });
});

describe('decideWillfireCallback: WILLFIRE_INPUTS', () => {
  it('rejects a missing WILLFIRE_INPUTS', () => {
    expect(decideWillfireCallback({ ...VALID, inputsJson: undefined })).toEqual({
      ok: false,
      reason: 'willfire-callback: WILLFIRE_INPUTS must be set',
    });
  });

  it('rejects an empty-string WILLFIRE_INPUTS the same as a missing one', () => {
    expect(decideWillfireCallback({ ...VALID, inputsJson: '' })).toEqual({
      ok: false,
      reason: 'willfire-callback: WILLFIRE_INPUTS must be set',
    });
  });

  it('rejects unparseable JSON', () => {
    expect(decideWillfireCallback({ ...VALID, inputsJson: '{not json' })).toEqual({
      ok: false,
      reason: 'willfire-callback: WILLFIRE_INPUTS is not valid JSON',
    });
  });

  it('rejects a JSON array', () => {
    expect(decideWillfireCallback({ ...VALID, inputsJson: '["js-vanilla"]' })).toEqual({
      ok: false,
      reason: 'willfire-callback: WILLFIRE_INPUTS must be a JSON object',
    });
  });

  it('rejects a JSON object with no fixture field', () => {
    expect(decideWillfireCallback({ ...VALID, inputsJson: '{"simulate_no_dist":"false"}' })).toEqual({
      ok: false,
      reason: "willfire-callback: WILLFIRE_INPUTS is missing a string 'fixture' field",
    });
  });

  it('rejects a non-string fixture field', () => {
    expect(decideWillfireCallback({ ...VALID, inputsJson: '{"fixture":true}' })).toEqual({
      ok: false,
      reason: "willfire-callback: WILLFIRE_INPUTS is missing a string 'fixture' field",
    });
  });

  it('rejects an empty-string fixture field', () => {
    expect(decideWillfireCallback({ ...VALID, inputsJson: '{"fixture":""}' })).toEqual({
      ok: false,
      reason: "willfire-callback: WILLFIRE_INPUTS is missing a string 'fixture' field",
    });
  });
});

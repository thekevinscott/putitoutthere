/**
 * Pins the cargo-http-registry `start` readiness decision extracted from the
 * "Start cargo-http-registry" bash: ready → write config, exit 0; not ready →
 * the exact `::error::` header, no config, exit 1. Pure. Assertions are exact.
 */

import { describe, expect, it } from 'vitest';

import { decideCargoRegistryStart } from './decide-start.js';

describe('decideCargoRegistryStart', () => {
  it('writes the cargo config and succeeds when the registry came up', () => {
    expect(decideCargoRegistryStart({ ready: true })).toEqual({
      exitCode: 0,
      errorLine: null,
      writeConfig: true,
    });
  });

  it('fails with the never-came-up header and no config when the poll timed out', () => {
    expect(decideCargoRegistryStart({ ready: false })).toEqual({
      exitCode: 1,
      errorLine: '::error::cargo-http-registry never came up; dumping log:',
      writeConfig: false,
    });
  });
});

/**
 * crates.io integration tests.
 *
 * Runs crates.isPublished against an msw-mocked registry. Covers:
 * - 404 → false (first release)
 * - 200 → true (already published)
 * - 5xx → TransientError (retry wrapper applies)
 *
 * Issue #27. Plan: §23.3.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { crates } from '../../src/handlers/crates.js';
import type { Ctx } from '../../src/types.js';
import { makeServer, makeState, type RegistryState } from './mock-registries.js';

let state: RegistryState;
const server = (() => {
  state = makeState();
  return makeServer(state);
})();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  state.crates.clear();
  state.pypi.clear();
  state.requests.length = 0;
  state.cratesNextStatus = undefined;
  state.pypiNextStatus = undefined;
});
afterEach(() => server.resetHandlers());

const pkg = {
  name: 'demo-crate',
  kind: 'crates' as const,
  path: '.',
  paths: ['**'],
  depends_on: [],
  first_version: '0.1.0',
  crates: 'demo-crate',
};

function ctx(): Ctx {
  return {
    cwd: '.',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
  };
}

describe('crates.isPublished (integration vs msw)', () => {
  it('returns false when registry returns 404', async () => {
    expect(await crates.isPublished(pkg, '0.1.0', ctx())).toBe(false);
    expect(state.requests).toHaveLength(1);
  });

  it('returns true when registry returns 200', async () => {
    state.crates.add('demo-crate@0.1.0');
    expect(await crates.isPublished(pkg, '0.1.0', ctx())).toBe(true);
  });

  it('bubbles a TransientError on 5xx', async () => {
    state.cratesNextStatus = 503;
    await expect(crates.isPublished(pkg, '0.1.0', ctx())).rejects.toThrow();
  });
});

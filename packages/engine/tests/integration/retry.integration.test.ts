/**
 * Retry-wrapper round-trip. Exercises the full isPublished → retry
 * chain: a transient 5xx from the registry should succeed on a
 * subsequent call (after msw flips the status). Stands in for the
 * real withRetry + jitter behavior the handlers compose at the
 * publish-orchestrator layer.
 *
 * Issue #27.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { crates } from '../../src/handlers/crates.js';
import { withRetry } from '../../src/retry.js';
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
  state.requests.length = 0;
  state.cratesNextStatus = undefined;
});
afterEach(() => server.resetHandlers());

const pkg = {
  name: 'flaky-crate',
  kind: 'crates' as const,
  path: '.',
  paths: ['**'],
  depends_on: [],
  first_version: '0.1.0',
};

function ctx(): Ctx {
  return {
    cwd: '.',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
  };
}

describe('retry wrapper + transient registry failures', () => {
  it('recovers from a single 5xx by retrying', async () => {
    // First call: 503 (transient). Second call: 404 (not published).
    state.cratesNextStatus = 503;
    const result = await withRetry(() => crates.isPublished(pkg, '0.1.0', ctx()), {
      retries: 3,
      initialDelayMs: 1,
      multiplier: 2,
      jitter: 0,
    });
    expect(result).toBe(false);
    expect(state.requests.length).toBeGreaterThanOrEqual(2);
  });

  it('gives up after retries if every call fails', async () => {
    const msw = await import('msw');
    server.use(
      msw.http.get(
        'https://crates.io/api/v1/crates/:name/:version',
        () => new msw.HttpResponse(JSON.stringify({ err: 'down' }), { status: 500 }),
      ),
    );
    await expect(
      withRetry(() => crates.isPublished(pkg, '0.1.0', ctx()), {
        retries: 2,
        initialDelayMs: 1,
        multiplier: 2,
        jitter: 0,
      }),
    ).rejects.toThrow();
  });
});

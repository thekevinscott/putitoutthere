/**
 * PyPI integration tests. Runs pypi.isPublished against msw.
 *
 * Covers 404 / 200 / 5xx paths. publish/writeVersion stay in unit
 * tests — they shell out to `twine` and read from the filesystem, not
 * HTTP endpoints.
 *
 * Issue #27.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { pypi } from '../../src/handlers/pypi.js';
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
  state.pypi.clear();
  state.crates.clear();
  state.requests.length = 0;
  state.cratesNextStatus = undefined;
  state.pypiNextStatus = undefined;
});
afterEach(() => server.resetHandlers());

const pkg = {
  name: 'demo-py',
  kind: 'pypi' as const,
  path: '.',
  paths: ['**'],
  depends_on: [],
  first_version: '0.1.0',
};

function ctx(): Ctx {
  return {
    cwd: '.',
    dryRun: true,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
  };
}

describe('pypi.isPublished (integration vs msw)', () => {
  it('returns false on 404', async () => {
    expect(await pypi.isPublished(pkg, '0.1.0', ctx())).toBe(false);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]!.url).toContain('/pypi/demo-py/0.1.0/json');
  });

  it('returns true on 200 with matching version payload', async () => {
    state.pypi.add('demo-py@0.1.0');
    expect(await pypi.isPublished(pkg, '0.1.0', ctx())).toBe(true);
  });

  it('throws a TransientError on 5xx so retry-wrapper kicks in', async () => {
    state.pypiNextStatus = 502;
    await expect(pypi.isPublished(pkg, '0.1.0', ctx())).rejects.toThrow();
  });
});

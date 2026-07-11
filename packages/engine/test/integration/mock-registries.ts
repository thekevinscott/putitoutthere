/**
 * Registry mocks for integration tests.
 *
 * Uses msw (node-level fetch interception) to stand in for:
 * - crates.io: GET /api/v1/crates/{name}/{version}
 * - PyPI:      GET /pypi/{name}/{version}/json
 *
 * npm uses execFileSync (not fetch), so its mock lives with the
 * individual test files via vi.mock('node:child_process', ...).
 *
 * Issue #27. Plan: §23.3.
 */

import { http, HttpResponse } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';

export interface RegistryState {
  /** `crate@version` → published */
  crates: Set<string>;
  /** `pkg@version` → published */
  pypi: Set<string>;
  /** If set, next crates.io GET returns this status */
  cratesNextStatus?: number;
  /** If set, next PyPI GET returns this status */
  pypiNextStatus?: number;
  /** Request log for assertions */
  requests: Array<{ url: string; method: string }>;
}

export function makeState(): RegistryState {
  return {
    crates: new Set(),
    pypi: new Set(),
    requests: [],
  };
}

export function makeServer(state: RegistryState): SetupServerApi {
  return setupServer(
    // crates.io: GET /api/v1/crates/{name}/{version}
    http.get('https://crates.io/api/v1/crates/:name/:version', ({ params, request }) => {
      state.requests.push({ url: request.url, method: 'GET' });
      if (state.cratesNextStatus !== undefined) {
        const s = state.cratesNextStatus;
        state.cratesNextStatus = undefined;
        return new HttpResponse(JSON.stringify({ error: 'simulated' }), { status: s });
      }
      const key = `${String(params.name)}@${String(params.version)}`;
      if (state.crates.has(key)) {
        return HttpResponse.json({ version: { num: String(params.version) } }, { status: 200 });
      }
      return new HttpResponse(JSON.stringify({ errors: [{ detail: 'not found' }] }), { status: 404 });
    }),

    // PyPI: GET /pypi/{name}/{version}/json
    http.get('https://pypi.org/pypi/:name/:version/json', ({ params, request }) => {
      state.requests.push({ url: request.url, method: 'GET' });
      if (state.pypiNextStatus !== undefined) {
        const s = state.pypiNextStatus;
        state.pypiNextStatus = undefined;
        return new HttpResponse(JSON.stringify({ message: 'simulated' }), { status: s });
      }
      const key = `${String(params.name)}@${String(params.version)}`;
      if (state.pypi.has(key)) {
        return HttpResponse.json({ info: { version: String(params.version) } }, { status: 200 });
      }
      return new HttpResponse('{"message":"Not Found"}', { status: 404 });
    }),
  );
}

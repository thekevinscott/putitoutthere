import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Ctx } from '../types.js';
import { pypiTrustPosture } from './pypi-trust-posture.js';

vi.mock('./pypi-name-for.js', async () => await vi.importActual<typeof import('./pypi-name-for.js')>('./pypi-name-for.js'));

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    cwd: '.',
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: {},
    artifacts: { get: () => '', has: () => false },
    ...over,
  };
}

function basePkg(over: Partial<{ name: string; pypi?: string }> = {}): { name: string; pypi?: string } {
  return { name: 'demo-python', pypi: 'demo-pkg', ...over };
}

describe('pypiTrustPosture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockPypi(opts: {
    jsonStatus?: number;
    urls?: Array<{ filename?: string }>;
    provStatus?: number;
  }): void {
    vi.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/provenance')) {
        return Promise.resolve(new Response('{}', { status: opts.provStatus ?? 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ urls: opts.urls ?? [] }), { status: opts.jsonStatus ?? 200 }),
      );
    });
  }

  it('oidc when the integrity provenance endpoint returns 200', async () => {
    mockPypi({ urls: [{ filename: 'demo-0.1.0.tar.gz' }], provStatus: 200 });
    expect(await pypiTrustPosture(basePkg(), '0.1.0', makeCtx())).toBe('oidc');
  });

  it('token when the integrity provenance endpoint returns 404', async () => {
    mockPypi({ urls: [{ filename: 'demo-0.1.0.tar.gz' }], provStatus: 404 });
    expect(await pypiTrustPosture(basePkg(), '0.1.0', makeCtx())).toBe('token');
  });

  it('token when the published version has no files', async () => {
    mockPypi({ urls: [] });
    expect(await pypiTrustPosture(basePkg(), '0.1.0', makeCtx())).toBe('token');
  });

  it('throws when the version json is unreachable', async () => {
    mockPypi({ jsonStatus: 503 });
    await expect(pypiTrustPosture(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/503/);
  });

  it('throws when the provenance endpoint errors', async () => {
    mockPypi({ urls: [{ filename: 'x' }], provStatus: 500 });
    await expect(pypiTrustPosture(basePkg(), '0.1.0', makeCtx())).rejects.toThrow(/500/);
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { Ctx } from '../types.js';
import { pypiLatestVersion } from './pypi-latest-version.js';

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

describe('pypiLatestVersion', () => {
  it('returns info.version on 200', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ info: { version: '3.1.0' } }), { status: 200 }),
    );
    expect(await pypiLatestVersion(basePkg(), makeCtx())).toBe('3.1.0');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo-pkg/json',
      expect.objectContaining({ method: 'GET' }) as object,
    );
    fetchSpy.mockRestore();
  });

  it('returns null when the 200 body carries no info.version', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ info: {} }), { status: 200 }),
    );
    expect(await pypiLatestVersion(basePkg(), makeCtx())).toBeNull();
    fetchSpy.mockRestore();
  });

  it('returns null on 404 (never published)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"message":"Not Found"}', { status: 404 }),
    );
    expect(await pypiLatestVersion(basePkg(), makeCtx())).toBeNull();
    fetchSpy.mockRestore();
  });

  it('throws TransientError on 5xx', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 500 }),
    );
    await expect(pypiLatestVersion(basePkg(), makeCtx())).rejects.toThrow(/500/);
    fetchSpy.mockRestore();
  });
});

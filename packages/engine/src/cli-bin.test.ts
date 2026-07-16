/**
 * Unit suite for the CLI binary entry (`cli-bin.ts`). Isolated per the
 * unit-suite convention: `./cli.js` — the dispatcher this entry point
 * drives — is mocked (bare automock, so the double can't drift from the
 * source), leaving only `cli-bin.ts`'s own wiring under test: it forwards
 * `process.argv` to `run`, exits with the resolved code, and maps a
 * rejection to a fatal exit 4. The real dispatch behaviour is covered at
 * the integration and e2e-cli tiers. See #201 for why the entry point is
 * a separate module from `cli.ts` (ncc bundling of `action.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./cli.js');

import { run } from './cli.js';

const runMock = vi.mocked(run);

let savedArgv: string[];

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  savedArgv = process.argv;
  vi.resetModules();
});

afterEach(() => {
  process.argv = savedArgv;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('cli-bin', () => {
  it('forwards process.argv to run and exits with the resolved code', async () => {
    runMock.mockResolvedValue(3);
    process.argv = ['node', 'putitoutthere', 'plan', '--cwd', '/x'];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('./cli-bin.js');
    await flush();

    expect(runMock).toHaveBeenCalledWith(['node', 'putitoutthere', 'plan', '--cwd', '/x']);
    expect(exit).toHaveBeenCalledWith(3);
  });

  it('maps a dispatcher rejection to a fatal exit 4 with a message', async () => {
    runMock.mockRejectedValue(new Error('boom'));
    process.argv = ['node', 'putitoutthere', 'plan'];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      stderr.push(typeof c === 'string' ? c : c.toString());
      return true;
    });

    await import('./cli-bin.js');
    await flush();

    expect(exit).toHaveBeenCalledWith(4);
    expect(stderr.join('')).toMatch(/fatal: boom/);
  });

  it('stringifies a non-Error rejection in the fatal message', async () => {
    runMock.mockRejectedValue('plain string boom');
    process.argv = ['node', 'putitoutthere', 'plan'];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      stderr.push(typeof c === 'string' ? c : c.toString());
      return true;
    });

    await import('./cli-bin.js');
    await flush();

    expect(exit).toHaveBeenCalledWith(4);
    expect(stderr.join('')).toMatch(/fatal: plain string boom/);
  });
});

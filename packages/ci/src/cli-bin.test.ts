import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Automock (no factory): vitest generates the double from the real module, so
// it can't drift from the source — satisfying the unit-suite isolation lint
// without a hand-written (untyped) factory.
vi.mock('./cli.js');

import { run } from './cli.js';

const runMock = vi.mocked(run);

let argv: string[];

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  argv = process.argv;
  vi.resetModules();
});

afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('cli-bin', () => {
  it('exits with the code the dispatcher resolves, passing process.argv through', async () => {
    runMock.mockResolvedValue(3);
    process.argv = ['node', 'piot-ci', 'evidence-check'];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('./cli-bin.js');
    await flush();

    expect(runMock).toHaveBeenCalledWith(['node', 'piot-ci', 'evidence-check']);
    expect(exit).toHaveBeenCalledWith(3);
  });

  it('maps a dispatcher rejection to a fatal exit 4 with a message', async () => {
    runMock.mockRejectedValue(new Error('boom'));
    process.argv = ['node', 'piot-ci', 'evidence-check'];
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
    // Exercises the `String(err)` arm of the message ternary — a rejection
    // that is not an Error instance (e.g. a thrown string).
    runMock.mockRejectedValue('kaboom');
    process.argv = ['node', 'piot-ci', 'evidence-check'];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      stderr.push(typeof c === 'string' ? c : c.toString());
      return true;
    });

    await import('./cli-bin.js');
    await flush();

    expect(exit).toHaveBeenCalledWith(4);
    expect(stderr.join('')).toMatch(/fatal: kaboom/);
  });
});

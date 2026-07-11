import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Automock (no factory): vitest generates the double from the real module, so
// it can't drift from the source — satisfying the unit-suite isolation lint
// without a hand-written (untyped) factory.
vi.mock('./cli.js');

import { run } from './cli.js';

const runMock = vi.mocked(run);

let argv: string[];

beforeEach(() => {
  argv = process.argv;
});

afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('cli-bin', () => {
  it('exits with the code the dispatcher returns, passing process.argv through', async () => {
    runMock.mockReturnValue(3);
    process.argv = ['node', 'piot-ci', 'evidence-check'];
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('./cli-bin.js');

    expect(runMock).toHaveBeenCalledWith(['node', 'piot-ci', 'evidence-check']);
    expect(exit).toHaveBeenCalledWith(3);
  });
});

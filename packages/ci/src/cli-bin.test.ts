import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./cli.js', async () => {
  const actual = await vi.importActual<typeof import('./cli.js')>('./cli.js');
  return { ...actual, run: vi.fn() };
});

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

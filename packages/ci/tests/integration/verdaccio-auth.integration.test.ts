/**
 * Integration test for the Verdaccio-auth harness (#453, epic #442).
 *
 * Drives the real `piot-ci verdaccio-auth` dispatch in-process — `run()` →
 * `runVerdaccioAuth` → `decideVerdaccioAuth` + `parseNpmPaths` — with only the
 * OS boundary (the exec seam, `node:fs/promises`) mocked. Exercises the real
 * decision, so the token-validity gate, the per-package `.npmrc` contents, and
 * the `::add-mask::` / `Wrote` lines are asserted through the actual command.
 */

import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';
import { execCapture } from '../../src/utils/exec-capture.js';
import { sleep } from '../../src/utils/sleep.js';

vi.mock('../../src/utils/exec-capture.js');
vi.mock('../../src/utils/sleep.js');
vi.mock('node:fs/promises');

const exec = vi.mocked(execCapture);
let out: string[];

function stub(putResponse: string): void {
  exec.mockImplementation((_cmd, args) =>
    Promise.resolve({
      stdout: (args as readonly string[]).includes('-X') ? putResponse : '',
      stderr: '',
    }),
  );
}

beforeEach(() => {
  out = [];
  vi.mocked(sleep).mockResolvedValue(undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MATRIX;
});

const verdaccio = (): Promise<number> => run(['node', 'piot-ci', 'verdaccio-auth']);

describe('piot-ci verdaccio-auth (integration)', () => {
  it('writes a per-package .npmrc and masks the token on a valid user-create', async () => {
    process.env.MATRIX = JSON.stringify([
      { kind: 'npm', path: 'packages/js' },
      { kind: 'crates', path: 'crate' },
    ]);
    stub('{"token":"secret-tok"}');
    await expect(verdaccio()).resolves.toBe(0);
    expect(writeFile).toHaveBeenCalledWith(
      'fixture-tree/packages/js/.npmrc',
      'registry=http://localhost:4873/\n//localhost:4873/:_authToken=secret-tok\nalways-auth=true\n',
    );
    expect(out.join('')).toBe(
      'Verdaccio up (attempt 1)\n::add-mask::secret-tok\nWrote fixture-tree/packages/js/.npmrc\n',
    );
  });

  it('fails, echoing the response, when the user-create returns no token', async () => {
    process.env.MATRIX = '[]';
    stub('{}');
    await expect(verdaccio()).resolves.toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
    expect(out.join('')).toBe(
      'Verdaccio up (attempt 1)\n::error::Verdaccio user-create did not return a token. Response: {}\n',
    );
  });
});

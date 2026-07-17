/**
 * Integration test for the Verdaccio-auth harness (#453, epic #442).
 *
 * Drives the real `piot-ci verdaccio-auth` dispatch in-process — `run()` →
 * `runVerdaccioAuth` → `decideVerdaccioAuth` + `parseNpmPaths` — with only the
 * OS boundary (the exec seam, `node:fs/promises`) mocked. Exercises the real
 * decision, so the token-validity gate, the per-package `.npmrc` contents, and
 * the `::add-mask::` / `Wrote` lines are asserted through the actual command.
 */

import type * as ChildProcess from 'node:child_process';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam + the real `sleep`)
// for real and mock only the Node built-in underneath: `execFile` (what
// `execCapture` uses). The `/-/ping` probe succeeds on the first curl, so the
// retry `sleep` is never reached — leaving `sleep` un-mocked (mocking it would
// trip the testing-conventions `no-first-party-mock` gate) is safe here.
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});
vi.mock('node:fs/promises');

const execFileMock = vi.mocked(execFile);
let out: string[];

function stub(putResponse: string): void {
  execFileMock.mockImplementation(((_cmd: string, args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    cb(null, [...(args ?? [])].includes('-X') ? putResponse : '', '');
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
}

beforeEach(() => {
  out = [];
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

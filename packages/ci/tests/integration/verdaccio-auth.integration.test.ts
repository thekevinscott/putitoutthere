/**
 * Integration test for the Verdaccio-auth harness (#453, epic #442).
 *
 * Drives the real `piot-ci verdaccio-auth` dispatch in-process — `run()` →
 * `runVerdaccioAuth` → `decideVerdaccioAuth` + `parseNpmPaths` — with only the
 * OS boundary (`node:child_process`, `node:fs`) mocked. Exercises the real
 * decision, so the token-validity gate, the per-package `.npmrc` contents, and
 * the `::add-mask::` / `Wrote` lines are asserted through the actual command.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process');
vi.mock('node:fs');

const exec = vi.mocked(execFileSync);
let out: string[];

function stub(putResponse: string): void {
  exec.mockImplementation((cmd, args) => {
    if (cmd === 'sleep') {
      return '';
    }
    return (args as readonly string[]).includes('-X') ? putResponse : '';
  });
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

const verdaccio = (): number => run(['node', 'piot-ci', 'verdaccio-auth']);

describe('piot-ci verdaccio-auth (integration)', () => {
  it('writes a per-package .npmrc and masks the token on a valid user-create', () => {
    process.env.MATRIX = JSON.stringify([
      { kind: 'npm', path: 'packages/js' },
      { kind: 'crates', path: 'crate' },
    ]);
    stub('{"token":"secret-tok"}');
    expect(verdaccio()).toBe(0);
    expect(writeFileSync).toHaveBeenCalledWith(
      'fixture-tree/packages/js/.npmrc',
      'registry=http://localhost:4873/\n//localhost:4873/:_authToken=secret-tok\nalways-auth=true\n',
    );
    expect(out.join('')).toBe(
      'Verdaccio up (attempt 1)\n::add-mask::secret-tok\nWrote fixture-tree/packages/js/.npmrc\n',
    );
  });

  it('fails, echoing the response, when the user-create returns no token', () => {
    process.env.MATRIX = '[]';
    stub('{}');
    expect(verdaccio()).toBe(1);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(out.join('')).toBe(
      'Verdaccio up (attempt 1)\n::error::Verdaccio user-create did not return a token. Response: {}\n',
    );
  });
});

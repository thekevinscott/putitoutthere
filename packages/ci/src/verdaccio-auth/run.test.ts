/**
 * Composition-root wiring test for the Verdaccio-auth harness (#453). Both
 * collaborators are mocked — the OS boundary (`node:child_process`, `node:fs`)
 * and `./decide.js` — so this isolates the plumbing: the bounded `/-/ping`
 * poll (curl + sleep), the user-create PUT (exact curl flags), the token parse
 * ('null' when absent), the `.npmrc` writes, and how decide()'s lines + exit
 * code surface. The decisions live in `decide.test.ts`.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decideVerdaccioAuth } from './decide.js';
import { runVerdaccioAuth } from './run.js';

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('./decide.js');

const exec = vi.mocked(execFileSync);
const decide = vi.mocked(decideVerdaccioAuth);
const out: string[] = [];

const PUT_ARGS = [
  '-fsS',
  '-X',
  'PUT',
  '-H',
  'Content-Type: application/json',
  '--data',
  '{"name":"e2e","password":"e2e","email":"e2e@piot.dev"}',
  'http://localhost:4873/-/user/org.couchdb.user:e2e',
];

// Route the subprocess calls: `sleep`, the ping curl, and the PUT curl. `ping`
// is the number of leading ping attempts that fail before one succeeds.
function stub({ ping = 0, putResponse = '{"token":"t"}' }: { ping?: number; putResponse?: string }): void {
  let pings = 0;
  exec.mockImplementation((cmd, args) => {
    if (cmd === 'sleep') {
      return '';
    }
    const a = args as readonly string[];
    if (a.includes('-X')) {
      return putResponse;
    }
    // ping curl
    pings += 1;
    if (pings <= ping) {
      throw new Error('connection refused');
    }
    return '';
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.MATRIX = '[]';
  decide.mockReturnValue({ exitCode: 0, lines: [], files: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MATRIX;
});

describe('runVerdaccioAuth: ping poll', () => {
  it('announces on the first successful ping and never sleeps', () => {
    stub({ ping: 0 });
    runVerdaccioAuth();
    expect(out[0]).toBe('Verdaccio up (attempt 1)\n');
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', 'http://localhost:4873/-/ping'], { stdio: 'ignore' });
    expect(exec).not.toHaveBeenCalledWith('sleep', ['1'], { stdio: 'ignore' });
  });

  it('reports "up" only when the ping curl actually succeeds (a throw is not up)', () => {
    // With ping:1 the first curl throws; if a throw were treated as success the
    // announced attempt would be 1, not 2.
    stub({ ping: 1 });
    runVerdaccioAuth();
    expect(out[0]).toBe('Verdaccio up (attempt 2)\n');
  });

  it('retries with a 1s sleep between attempts and announces the winning attempt', () => {
    stub({ ping: 3 });
    runVerdaccioAuth();
    expect(out[0]).toBe('Verdaccio up (attempt 4)\n');
    expect(exec).toHaveBeenCalledWith('sleep', ['1'], { stdio: 'ignore' });
    const sleeps = exec.mock.calls.filter((c) => c[0] === 'sleep').length;
    expect(sleeps).toBe(3);
  });

  it('fails after 10 unreachable attempts, never issuing the PUT', () => {
    stub({ ping: 10 });
    const code = runVerdaccioAuth();
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::Verdaccio /-/ping unreachable after 10 attempts\n');
    expect(exec).not.toHaveBeenCalledWith('curl', PUT_ARGS, { encoding: 'utf8' });
    expect(decide).not.toHaveBeenCalled();
    const sleeps = exec.mock.calls.filter((c) => c[0] === 'sleep').length;
    expect(sleeps).toBe(9);
  });
});

describe('runVerdaccioAuth: user-create + dispatch', () => {
  it('issues the exact user-create PUT once Verdaccio is up', () => {
    stub({ ping: 0 });
    runVerdaccioAuth();
    expect(exec).toHaveBeenCalledWith('curl', PUT_ARGS, { encoding: 'utf8' });
  });

  it('parses the token from the response and passes matrix + token + raw response to decide', () => {
    process.env.MATRIX = '[{"kind":"npm","path":"p"}]';
    stub({ ping: 0, putResponse: '{"token":"abc"}' });
    runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith({
      matrix: '[{"kind":"npm","path":"p"}]',
      token: 'abc',
      response: '{"token":"abc"}',
    });
  });

  it('passes the literal token "null" (matrix + raw response too) when the response has no token key', () => {
    process.env.MATRIX = '[]';
    stub({ ping: 0, putResponse: '{}' });
    runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith({ matrix: '[]', token: 'null', response: '{}' });
  });

  it('passes the literal token "null" when the response token is JSON null', () => {
    stub({ ping: 0, putResponse: '{"token":null}' });
    runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ token: 'null' }));
  });

  it('passes the empty-string token verbatim when the response token is empty', () => {
    stub({ ping: 0, putResponse: '{"token":""}' });
    runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ token: '' }));
  });

  it('defaults the matrix to an empty string when MATRIX is unset', () => {
    delete process.env.MATRIX;
    stub({ ping: 0, putResponse: '{"token":"t"}' });
    runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ matrix: '' }));
  });

  it('writes each .npmrc decide returns and prints its lines, returning its exit code', () => {
    stub({ ping: 0 });
    decide.mockReturnValue({
      exitCode: 0,
      lines: ['::add-mask::t', 'Wrote fixture-tree/p/.npmrc'],
      files: [{ path: 'fixture-tree/p/.npmrc', content: 'REGISTRY\n' }],
    });
    const code = runVerdaccioAuth();
    expect(code).toBe(0);
    expect(writeFileSync).toHaveBeenCalledWith('fixture-tree/p/.npmrc', 'REGISTRY\n');
    expect(out.join('')).toBe('Verdaccio up (attempt 1)\n::add-mask::t\nWrote fixture-tree/p/.npmrc\n');
  });

  it('surfaces decide’s failure exit code without writing files', () => {
    stub({ ping: 0 });
    decide.mockReturnValue({
      exitCode: 1,
      lines: ['::error::Verdaccio user-create did not return a token. Response: {}'],
      files: [],
    });
    const code = runVerdaccioAuth();
    expect(code).toBe(1);
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

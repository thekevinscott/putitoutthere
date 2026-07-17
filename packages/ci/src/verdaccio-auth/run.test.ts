/**
 * Composition-root wiring test for the Verdaccio-auth harness (#453). Both
 * collaborators are mocked — the OS boundary (the exec seam, `node:fs/promises`)
 * and `./decide.js` — so this isolates the plumbing: the bounded `/-/ping` poll
 * (curl + sleep), the user-create PUT (exact curl flags), the token parse
 * ('null' when absent), the `.npmrc` writes, and how decide()'s lines + exit
 * code surface. The decisions live in `decide.test.ts`.
 */

import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { sleep } from '../utils/sleep.js';
import { decideVerdaccioAuth } from './decide.js';
import { runVerdaccioAuth } from './run.js';

vi.mock('../utils/exec-capture.js');
vi.mock('../utils/sleep.js');
vi.mock('node:fs/promises');
vi.mock('./decide.js');

const exec = vi.mocked(execCapture);
const sleepMock = vi.mocked(sleep);
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

// Route the subprocess calls: the ping curl and the PUT curl (`sleep` is its
// own mock). `ping` is the number of leading ping attempts that fail before one
// succeeds.
function stub({ ping = 0, putResponse = '{"token":"t"}' }: { ping?: number; putResponse?: string }): void {
  let pings = 0;
  exec.mockImplementation((_cmd, args) => {
    if (args.includes('-X')) {
      return Promise.resolve({ stdout: putResponse, stderr: '' });
    }
    // ping curl
    pings += 1;
    if (pings <= ping) {
      return Promise.reject(new Error('connection refused'));
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  sleepMock.mockResolvedValue(undefined);
  process.env.MATRIX = '[]';
  decide.mockReturnValue({ exitCode: 0, lines: [], files: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MATRIX;
});

describe('runVerdaccioAuth: ping poll', () => {
  it('announces on the first successful ping and never sleeps', async () => {
    stub({ ping: 0 });
    await runVerdaccioAuth();
    expect(out[0]).toBe('Verdaccio up (attempt 1)\n');
    expect(exec).toHaveBeenCalledWith('curl', ['-fsS', 'http://localhost:4873/-/ping']);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('reports "up" only when the ping curl actually succeeds (a throw is not up)', async () => {
    // With ping:1 the first curl throws; if a throw were treated as success the
    // announced attempt would be 1, not 2.
    stub({ ping: 1 });
    await runVerdaccioAuth();
    expect(out[0]).toBe('Verdaccio up (attempt 2)\n');
  });

  it('retries with a 1s sleep between attempts and announces the winning attempt', async () => {
    stub({ ping: 3 });
    await runVerdaccioAuth();
    expect(out[0]).toBe('Verdaccio up (attempt 4)\n');
    expect(sleepMock).toHaveBeenCalledWith(1000);
    expect(sleepMock).toHaveBeenCalledTimes(3);
  });

  it('fails after 10 unreachable attempts, never issuing the PUT', async () => {
    stub({ ping: 10 });
    const code = await runVerdaccioAuth();
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::Verdaccio /-/ping unreachable after 10 attempts\n');
    expect(exec).not.toHaveBeenCalledWith('curl', PUT_ARGS);
    expect(decide).not.toHaveBeenCalled();
    expect(sleepMock).toHaveBeenCalledTimes(9);
  });
});

describe('runVerdaccioAuth: user-create + dispatch', () => {
  it('issues the exact user-create PUT once Verdaccio is up', async () => {
    stub({ ping: 0 });
    await runVerdaccioAuth();
    expect(exec).toHaveBeenCalledWith('curl', PUT_ARGS);
  });

  it('parses the token from the response and passes matrix + token + raw response to decide', async () => {
    process.env.MATRIX = '[{"kind":"npm","path":"p"}]';
    stub({ ping: 0, putResponse: '{"token":"abc"}' });
    await runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith({
      matrix: '[{"kind":"npm","path":"p"}]',
      token: 'abc',
      response: '{"token":"abc"}',
    });
  });

  it('passes the literal token "null" (matrix + raw response too) when the response has no token key', async () => {
    process.env.MATRIX = '[]';
    stub({ ping: 0, putResponse: '{}' });
    await runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith({ matrix: '[]', token: 'null', response: '{}' });
  });

  it('passes the literal token "null" when the response token is JSON null', async () => {
    stub({ ping: 0, putResponse: '{"token":null}' });
    await runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ token: 'null' }));
  });

  it('passes the empty-string token verbatim when the response token is empty', async () => {
    stub({ ping: 0, putResponse: '{"token":""}' });
    await runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ token: '' }));
  });

  it('defaults the matrix to an empty string when MATRIX is unset', async () => {
    delete process.env.MATRIX;
    stub({ ping: 0, putResponse: '{"token":"t"}' });
    await runVerdaccioAuth();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ matrix: '' }));
  });

  it('writes each .npmrc decide returns and prints its lines, returning its exit code', async () => {
    stub({ ping: 0 });
    decide.mockReturnValue({
      exitCode: 0,
      lines: ['::add-mask::t', 'Wrote fixture-tree/p/.npmrc'],
      files: [{ path: 'fixture-tree/p/.npmrc', content: 'REGISTRY\n' }],
    });
    const code = await runVerdaccioAuth();
    expect(code).toBe(0);
    expect(writeFile).toHaveBeenCalledWith('fixture-tree/p/.npmrc', 'REGISTRY\n');
    expect(out.join('')).toBe('Verdaccio up (attempt 1)\n::add-mask::t\nWrote fixture-tree/p/.npmrc\n');
  });

  it('surfaces decide’s failure exit code without writing files', async () => {
    stub({ ping: 0 });
    decide.mockReturnValue({
      exitCode: 1,
      lines: ['::error::Verdaccio user-create did not return a token. Response: {}'],
      files: [],
    });
    const code = await runVerdaccioAuth();
    expect(code).toBe(1);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

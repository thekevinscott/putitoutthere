import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execCapture } from './exec-capture.js';
import { ExecError } from './exec-error.js';

vi.mock('node:fs/promises', async () => await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'));
vi.mock('node:os', async () => await vi.importActual<typeof import('node:os')>('node:os'));
vi.mock('node:path', async () => await vi.importActual<typeof import('node:path')>('node:path'));
vi.mock('./exec-error.js', async () => await vi.importActual<typeof import('./exec-error.js')>('./exec-error.js'));

describe('execCapture', () => {
  it('captures stdout and stderr as strings', async () => {
    const { stdout, stderr } = await execCapture(process.execPath, [
      '-e',
      'console.log("hi"); console.error("err")',
    ]);
    expect(stdout).toBe('hi\n');
    expect(stderr).toBe('err\n');
  });

  it('rejects with ExecError carrying the exit status on non-zero exit', async () => {
    await expect(
      execCapture(process.execPath, ['-e', 'process.exit(3)']),
    ).rejects.toMatchObject({ name: 'ExecError', status: 3 });
  });

  it('rejects with status null and a cause when the binary is missing', async () => {
    let caught: unknown;
    try {
      await execCapture('definitely-not-a-real-binary-469', []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExecError);
    expect((caught as ExecError).status).toBeNull();
    expect((caught as ExecError).cause).toBeDefined();
  });

  describe('with a temp cwd', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await realpath(await mkdtemp(join(tmpdir(), 'exec-capture-')));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('honors the cwd option', async () => {
      const { stdout } = await execCapture(
        process.execPath,
        ['-e', 'console.log(process.cwd())'],
        { cwd: dir },
      );
      expect(stdout.trim()).toBe(dir);
    });
  });
});

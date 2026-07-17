import { spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execInherit } from './exec-inherit.js';
import { ExecError } from './exec-error.js';

// Wrap the real `spawn` in a spy: the subprocess still runs for real (the
// factory delegates to `actual.spawn`), but we can also assert the argv and
// the stdio/cwd/env options execInherit hands it.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock('./exec-error.js', async () => await vi.importActual<typeof import('./exec-error.js')>('./exec-error.js'));

const spawnMock = vi.mocked(spawn);

beforeEach(() => {
  spawnMock.mockClear();
});

describe('execInherit', () => {
  it('resolves when the child exits 0', async () => {
    await expect(execInherit(process.execPath, ['-e', ''])).resolves.toBeUndefined();
  });

  it('spawns the command with inherited stdio, forwarding cwd and env', async () => {
    // Pins the spawn options: `stdio: 'inherit'` (child streams straight to
    // our terminal, not an unread pipe) plus the caller's cwd and env. A
    // dropped options object or a changed stdio mode fails this assertion.
    const env = { ...process.env, PIOT_INHERIT_ENV: 'sentinel' };
    await execInherit(process.execPath, ['-e', ''], { cwd: process.cwd(), env });
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      ['-e', ''],
      expect.objectContaining({ stdio: 'inherit', cwd: process.cwd(), env }),
    );
  });

  it('rejects with ExecError carrying the exit status on non-zero exit', async () => {
    await expect(
      execInherit(process.execPath, ['-e', 'process.exit(2)']),
    ).rejects.toMatchObject({ name: 'ExecError', status: 2 });
  });

  it('rejects with empty stdout/stderr on non-zero exit (output was inherited, not captured)', async () => {
    // The close-path ExecError carries `''` for both stdout and stderr —
    // the child's output already went straight to the terminal, so there is
    // nothing to fold back into the error. Pins those two empty strings.
    let caught: unknown;
    try {
      await execInherit(process.execPath, ['-e', 'process.exit(2)']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExecError);
    expect((caught as ExecError).stdout).toBe('');
    expect((caught as ExecError).stderr).toBe('');
  });

  it('names the failed command and its space-joined args in the message', async () => {
    // Pins the `Command failed: ${cmd} ${args.join(' ')}` text: the cmd, the
    // literal prefix, and the single-space arg join must all appear verbatim.
    let caught: unknown;
    try {
      await execInherit(process.execPath, ['-e', 'process.exit(2)']);
    } catch (err) {
      caught = err;
    }
    const message = (caught as ExecError).message;
    expect(message).toContain('Command failed:');
    expect(message).toContain(process.execPath);
    expect(message).toContain('-e process.exit(2)');
  });

  it('rejects with status null when the binary is missing', async () => {
    let caught: unknown;
    try {
      await execInherit('definitely-not-a-real-binary-469', []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ExecError);
    expect((caught as ExecError).status).toBeNull();
    expect((caught as ExecError).cause).toBeDefined();
    // The spawn-error ExecError also carries `''` for stdout and stderr.
    expect((caught as ExecError).stdout).toBe('');
    expect((caught as ExecError).stderr).toBe('');
  });
});

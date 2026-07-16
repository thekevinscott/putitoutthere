import { describe, expect, it } from 'vitest';
import { execInherit } from './exec-inherit.js';
import { ExecError } from './exec-error.js';

describe('execInherit', () => {
  it('resolves when the child exits 0', async () => {
    await expect(execInherit(process.execPath, ['-e', ''])).resolves.toBeUndefined();
  });

  it('rejects with ExecError carrying the exit status on non-zero exit', async () => {
    await expect(
      execInherit(process.execPath, ['-e', 'process.exit(2)']),
    ).rejects.toMatchObject({ name: 'ExecError', status: 2 });
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
  });
});

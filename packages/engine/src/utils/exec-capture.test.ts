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

  it('records the argv on the ExecError so the failure dump can report it', async () => {
    // #617. Without this the dump renders an empty command block for every
    // failed subprocess.
    let caught: unknown;
    try {
      await execCapture(process.execPath, ['-e', 'process.exit(3)']);
    } catch (err) {
      caught = err;
    }
    expect((caught as ExecError).command).toEqual([process.execPath, '-e', 'process.exit(3)']);
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
    // A spawn failure has no output and no exit code; the argv is the only
    // thing left to say what was attempted.
    expect((caught as ExecError).command).toEqual(['definitely-not-a-real-binary-469']);
  });

  describe('capture ceiling (#664)', () => {
    // The seam hands `maxBuffer` straight to `execFile`, whose overflow
    // policy is not truncation: Node raises
    // `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and SIGTERMs the child. A
    // `cargo publish --verbose` that was going to succeed dies partway
    // through, and the engine reports a failure the tool never produced —
    // on a possibly half-completed registry upload, which is the
    // partial-publish state the all-or-nothing commitment exists to
    // prevent.
    //
    // The ceiling itself is worth having; killing for hitting it is not.
    // These pin the replacement policy: bound what we keep, keep the ends
    // that carry diagnosis, say so out loud, and let the child finish.
    //
    // `writeSync` rather than `process.stdout.write`: writes to a pipe are
    // async, so a chatty child that exits promptly can lose its own tail
    // and the assertions would pass for the wrong reason.
    const MIB = 1024 * 1024;
    const CEILING = 64 * 1024;
    const HEAD = 'PIOT-664-HEAD';
    const TAIL = 'PIOT-664-TAIL';

    /** A child that writes `bytes` to `fd`, bracketed by markers. */
    function chatty(fd: 1 | 2, bytes: number, exitCode = 0): string[] {
      return [
        '-e',
        [
          'const { writeSync } = require("node:fs");',
          'const line = "x".repeat(255) + "\\n";',
          `writeSync(${fd}, "${HEAD}\\n");`,
          `for (let n = 0; n < ${bytes}; n += line.length) { writeSync(${fd}, line); }`,
          `writeSync(${fd}, "${TAIL}\\n");`,
          `process.exitCode = ${exitCode};`,
        ].join('\n'),
      ];
    }

    it('lets a child that outruns the ceiling run to completion', async () => {
      // The whole point. Under execFile this rejects with
      // ERR_CHILD_PROCESS_STDIO_MAXBUFFER and the child is signalled dead.
      const { stdout } = await execCapture(
        process.execPath,
        chatty(1, 4 * CEILING),
        { maxBuffer: CEILING },
      );
      expect(stdout).toContain(HEAD);
    });

    it('keeps the tail of an over-ceiling stream, where the error lives', async () => {
      const { stdout } = await execCapture(
        process.execPath,
        chatty(1, 4 * CEILING),
        { maxBuffer: CEILING },
      );
      expect(stdout).toContain(TAIL);
    });

    it('announces the drop, with a byte count, at the top of the stream', async () => {
      // A stream that just stops is indistinguishable from a tool that
      // fell silent; the count is what makes the truncation legible. The
      // banner leads the stream rather than sitting at the cut so it
      // survives a downstream head-and-tail render (#651/#658).
      const { stdout } = await execCapture(
        process.execPath,
        chatty(1, 4 * CEILING),
        { maxBuffer: CEILING },
      );
      expect(stdout).toMatch(/^\[putitoutthere\] capture ceiling reached: dropped \d+ bytes/);
    });

    it('retains no more than the ceiling, so a runaway child cannot grow us', async () => {
      const { stdout } = await execCapture(
        process.execPath,
        chatty(1, 16 * CEILING),
        { maxBuffer: CEILING },
      );
      // Ceiling plus the banner.
      expect(stdout.length).toBeLessThan(CEILING + 512);
    });

    it('reports the real exit status of a chatty command that fails', async () => {
      // The diagnostic half: a tool that fails after outrunning the
      // ceiling must arrive as its own exit code with its own last words,
      // not as a status-null kill whose message names our buffer.
      let caught: unknown;
      try {
        await execCapture(process.execPath, chatty(2, 4 * CEILING, 101), { maxBuffer: CEILING });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ExecError);
      expect((caught as ExecError).status).toBe(101);
      expect((caught as ExecError).stderr).toContain(TAIL);
      expect((caught as ExecError).message).not.toContain('maxBuffer length exceeded');
    });

    it('leaves an ordinary verbose build untouched under the default ceiling', async () => {
      // Guard rail. A cold `cargo publish --verbose` of a mid-sized crate
      // was measured at ~380KB of stderr (#651); the default ceiling has
      // to sit far enough above that shape for the elision path to stay
      // theoretical. 3 MiB arrives whole and unmarked.
      const { stdout } = await execCapture(process.execPath, chatty(1, 3 * MIB));
      expect(stdout.length).toBeGreaterThan(3 * MIB);
      expect(stdout).toContain(HEAD);
      expect(stdout).toContain(TAIL);
      expect(stdout).not.toMatch(/capture ceiling reached/);
    });
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

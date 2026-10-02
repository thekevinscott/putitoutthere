/**
 * Drain stdout and stderr so a following `process.exit` cannot truncate them.
 * Pipe writes are async and `exit` drops what is queued, cutting a multi-MB
 * failure dump around 146KB — losing the tail where the error is (#664).
 * `process.exitCode` would flush but then waits on undici's pooled sockets. The
 * zero-length write is a position marker: stream writes complete in order.
 */
export async function flushStdio(): Promise<void> {
  for (const stream of [process.stdout, process.stderr]) {
    await new Promise<void>((resolve) => {
      stream.write('', () => {
        resolve();
      });
    });
  }
}

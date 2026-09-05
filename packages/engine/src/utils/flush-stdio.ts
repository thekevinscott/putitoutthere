/**
 * Drain stdout and stderr so a following `process.exit` cannot truncate them.
 *
 * Writes to a pipe are asynchronous and `process.exit` drops whatever is still
 * queued, so a multi-megabyte failure dump reaches the runner cut off around
 * 146KB — losing the tail, which is exactly where the failing tool prints its
 * error (#664). Assigning `process.exitCode` would also flush, but then exit
 * waits on every lingering handle (undici keeps sockets pooled after `fetch`),
 * so drain explicitly and keep the hard exit.
 *
 * The zero-length write is a position marker, not output: stream writes
 * complete in order, so its callback fires only once everything queued ahead
 * of it has reached the fd.
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

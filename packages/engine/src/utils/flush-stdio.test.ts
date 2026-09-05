import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushStdio } from './flush-stdio.js';

type Cb = () => void;

/** Records the write and fires its callback immediately. */
function stubImmediate(stream: NodeJS.WriteStream) {
  return vi.spyOn(stream, 'write').mockImplementation(((
    _chunk: unknown,
    cb?: Cb,
  ) => {
    cb?.();
    return true;
  }) as unknown as typeof stream.write);
}

/** Parks each write's callback in `pending` so the test controls completion. */
function stubDeferred(stream: NodeJS.WriteStream, pending: Cb[]) {
  return vi.spyOn(stream, 'write').mockImplementation(((
    _chunk: unknown,
    cb?: Cb,
  ) => {
    if (cb) {
      pending.push(cb);
    }
    return true;
  }) as unknown as typeof stream.write);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('flushStdio', () => {
  it('drains both stdout and stderr', async () => {
    const out = stubImmediate(process.stdout);
    const err = stubImmediate(process.stderr);

    await flushStdio();

    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('probes with a zero-length chunk, so nothing is added to the output', async () => {
    const out = stubImmediate(process.stdout);
    stubImmediate(process.stderr);

    await flushStdio();

    expect(out).toHaveBeenCalledWith('', expect.any(Function));
  });

  it('waits for each stream to report the write flushed', async () => {
    const pending: Cb[] = [];
    stubDeferred(process.stdout, pending);
    stubDeferred(process.stderr, pending);
    let settled = false;

    const done = flushStdio().then(() => {
      settled = true;
    });

    await tick();
    expect(settled).toBe(false);
    expect(pending).toHaveLength(1);

    pending.shift()?.();
    await tick();
    expect(settled).toBe(false);
    // stderr is only probed once stdout has drained.
    expect(pending).toHaveLength(1);

    pending.shift()?.();
    await done;
    expect(settled).toBe(true);
  });
});

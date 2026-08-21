/**
 * `emitReleaseOutputs` unit coverage (#461, #623). Isolated per the
 * unit-suite convention: the only collaborator is `node:fs/promises`'s
 * `appendFile`, which is mocked, so each case asserts exactly the bytes
 * the runner would read back out of `$GITHUB_OUTPUT`. The real file write
 * is exercised at the integration tier
 * (`tests/integration/pypi-delegated-tag.integration.test.ts`).
 */

import { appendFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitReleaseOutputs } from './emit-release-outputs.js';
import type { PublishOutput } from './publish.js';

vi.mock('node:fs/promises');

const appendFileMock = vi.mocked(appendFile);

const entry = (
  name: string,
  status: 'published' | 'already-published' | 'delegated',
): PublishOutput['published'][number] => ({
  package: name,
  version: '1.2.3',
  result: { status },
  tag: `${name}-v1.2.3`,
});

/** Everything written to the output file, concatenated. */
function written(): string {
  return appendFileMock.mock.calls.map((c) => String(c[1] as string)).join('');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('emitReleaseOutputs (#461, #623)', () => {
  it('reports a shipped package under the released pair only', async () => {
    await emitReleaseOutputs([entry('lib-rust', 'published')], '/gha/output.txt');

    expect(written()).toBe(
      'released=true\n' +
        'released_packages=[{"name":"lib-rust","version":"1.2.3","tag":"lib-rust-v1.2.3"}]\n' +
        'delegated=false\n' +
        'delegated_packages=[]\n',
    );
    // Pin the target and the encoding: a StringLiteral mutant dropping
    // 'utf8' would write the default-encoded bytes instead.
    expect(appendFileMock).toHaveBeenCalledWith(
      '/gha/output.txt',
      expect.stringContaining('released='),
      'utf8',
    );
  });

  it('reports a delegated package under the delegated pair only', async () => {
    // #623: a delegated upload has not shipped — no tag has been cut and
    // nothing is on the registry — so it must not count as released. The
    // tag it *will* get rides along for the job that performs the upload.
    await emitReleaseOutputs([entry('lib-py', 'delegated')], '/gha/output.txt');

    expect(written()).toBe(
      'released=false\n' +
        'released_packages=[]\n' +
        'delegated=true\n' +
        'delegated_packages=[{"name":"lib-py","version":"1.2.3","tag":"lib-py-v1.2.3"}]\n',
    );
  });

  it('splits a mixed run across the two pairs', async () => {
    await emitReleaseOutputs(
      [entry('lib-py', 'delegated'), entry('lib-rust', 'published'), entry('lib-js', 'already-published')],
      '/gha/output.txt',
    );

    const out = written();
    expect(out).toContain(
      'released_packages=[{"name":"lib-rust","version":"1.2.3","tag":"lib-rust-v1.2.3"}]\n',
    );
    expect(out).toContain(
      'delegated_packages=[{"name":"lib-py","version":"1.2.3","tag":"lib-py-v1.2.3"}]\n',
    );
    // An idempotent re-run's `already-published` rows are neither: they
    // did not ship this run and nobody owes them an upload.
    expect(out).not.toContain('lib-js');
    expect(out).toContain('released=true\n');
    expect(out).toContain('delegated=true\n');
  });

  it('reports both as false when nothing shipped and nothing was delegated', async () => {
    await emitReleaseOutputs([entry('lib-js', 'already-published')], '/gha/output.txt');

    expect(written()).toBe(
      'released=false\nreleased_packages=[]\ndelegated=false\ndelegated_packages=[]\n',
    );
  });

  it('is a no-op outside Actions, where $GITHUB_OUTPUT is unset', async () => {
    // A local `piot publish` has no output file; it must not need one,
    // and must not write to some other path.
    await emitReleaseOutputs([entry('lib-rust', 'published')], undefined);
    await emitReleaseOutputs([entry('lib-rust', 'published')], '');

    expect(appendFileMock).not.toHaveBeenCalled();
  });
});

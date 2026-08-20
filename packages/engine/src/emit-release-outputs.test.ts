import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emitReleaseOutputs } from './emit-release-outputs.js';
import type { PublishOutput } from './publish-types.js';

const entry = (
  name: string,
  status: 'published' | 'already-published' | 'delegated',
): PublishOutput['published'][number] => ({
  package: name,
  version: '1.2.3',
  result: { status },
  tag: `${name}-v1.2.3`,
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piot-release-outputs-'));
  file = join(dir, 'gha-output.txt');
  writeFileSync(file, '', 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('emitReleaseOutputs (#461, #623)', () => {
  it('reports a shipped package under the released pair only', async () => {
    await emitReleaseOutputs([entry('lib-rust', 'published')], file);

    expect(readFileSync(file, 'utf8')).toBe(
      'released=true\n' +
        'released_packages=[{"name":"lib-rust","version":"1.2.3","tag":"lib-rust-v1.2.3"}]\n' +
        'delegated=false\n' +
        'delegated_packages=[]\n',
    );
  });

  it('reports a delegated package under the delegated pair only', async () => {
    // #623: a delegated upload has not shipped — no tag has been cut and
    // nothing is on the registry — so it must not count as released. The
    // tag it *will* get rides along for the job that performs the upload.
    await emitReleaseOutputs([entry('lib-py', 'delegated')], file);

    expect(readFileSync(file, 'utf8')).toBe(
      'released=false\n' +
        'released_packages=[]\n' +
        'delegated=true\n' +
        'delegated_packages=[{"name":"lib-py","version":"1.2.3","tag":"lib-py-v1.2.3"}]\n',
    );
  });

  it('splits a mixed run across the two pairs', async () => {
    await emitReleaseOutputs(
      [entry('lib-py', 'delegated'), entry('lib-rust', 'published'), entry('lib-js', 'already-published')],
      file,
    );

    const out = readFileSync(file, 'utf8');
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
    await emitReleaseOutputs([entry('lib-js', 'already-published')], file);

    expect(readFileSync(file, 'utf8')).toBe(
      'released=false\nreleased_packages=[]\ndelegated=false\ndelegated_packages=[]\n',
    );
  });

  it('appends rather than replacing what the step already wrote', async () => {
    writeFileSync(file, 'matrix=[]\n', 'utf8');
    await emitReleaseOutputs([], file);
    expect(readFileSync(file, 'utf8')).toMatch(/^matrix=\[\]\n/);
  });

  it('is a no-op outside Actions, where $GITHUB_OUTPUT is unset', async () => {
    await emitReleaseOutputs([entry('lib-rust', 'published')], undefined);
    await emitReleaseOutputs([entry('lib-rust', 'published')], '');
    // Nothing to write to, and nothing thrown — a local `piot publish`
    // must not need an output file to exist.
    expect(readFileSync(file, 'utf8')).toBe('');
  });
});

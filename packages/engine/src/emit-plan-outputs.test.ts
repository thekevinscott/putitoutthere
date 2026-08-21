/**
 * `emitPlanOutputs` unit coverage (#146, #622). Isolated per the unit-suite
 * convention: the only collaborator is `node:fs/promises`'s `appendFile`,
 * which is mocked, so each case asserts exactly the bytes the runner would
 * read back out of `$GITHUB_OUTPUT`. The real file write is exercised at the
 * integration tier (`tests/integration/crates-auth-gate.integration.test.ts`).
 */

import { appendFile } from 'node:fs/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitPlanOutputs } from './emit-plan-outputs.js';
import type { MatrixRow } from './plan.js';
import type { PlanVerdict } from './plan-status-types.js';
import type { Kind } from './types.js';

vi.mock('node:fs/promises');

const appendFileMock = vi.mocked(appendFile);

const row = (name: string, kind: Kind): MatrixRow => ({
  name,
  kind,
  version: '1.2.3',
  target: 'noarch',
  runs_on: 'ubuntu-latest',
  artifact_name: `${name}-artifact`,
  artifact_path: 'artifacts',
  path: `packages/${name}`,
});

const verdict = (
  pkg: string,
  kind: Kind,
  value: PlanVerdict['verdict'],
): PlanVerdict => ({ package: pkg, kind, version: '1.2.3', verdict: value });

/** Everything written to the output file, concatenated. */
function written(): string {
  return appendFileMock.mock.calls.map((c) => String(c[1] as string)).join('');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('emitPlanOutputs (#146, #622)', () => {
  it('writes the matrix and the kinds still needing a publish', async () => {
    await emitPlanOutputs(
      [row('lib-rust', 'crates')],
      [verdict('lib-rust', 'crates', 'publish')],
      '/gha/output.txt',
    );

    expect(written()).toBe(
      'matrix=[{"name":"lib-rust","kind":"crates","version":"1.2.3","target":"noarch",' +
        '"runs_on":"ubuntu-latest","artifact_name":"lib-rust-artifact",' +
        '"artifact_path":"artifacts","path":"packages/lib-rust"}]\n' +
        'unpublished_kinds=["crates"]\n',
    );
    // Pin the target and the encoding: a StringLiteral mutant dropping
    // 'utf8' would write the default-encoded bytes instead.
    expect(appendFileMock).toHaveBeenCalledWith(
      '/gha/output.txt',
      expect.stringContaining('unpublished_kinds='),
      'utf8',
    );
  });

  it('writes an empty kinds array when every planned version is already live', async () => {
    // `contains('[]', '"crates"')` is false, which is what makes the
    // reusable workflow skip the crates.io OIDC exchange (#622).
    await emitPlanOutputs(
      [row('lib-rust', 'crates')],
      [verdict('lib-rust', 'crates', 'skip')],
      '/gha/output.txt',
    );

    expect(written()).toContain('unpublished_kinds=[]\n');
    // The matrix is unchanged — the package still builds, only the auth
    // gate narrows.
    expect(written()).toContain('"kind":"crates"');
  });

  it('emits both keys in one append so a partial write cannot desync them', async () => {
    await emitPlanOutputs(
      [row('lib-js', 'npm')],
      [verdict('lib-js', 'npm', 'publish')],
      '/gha/output.txt',
    );

    expect(appendFileMock).toHaveBeenCalledOnce();
    const lines = written().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^matrix=\[\{"name":"lib-js"/);
    expect(lines[1]).toBe('unpublished_kinds=["npm"]');
  });

  it('writes nothing at all when the plan is empty (#146)', async () => {
    // Emitting `matrix=[]` races against the "output not set" branch the
    // consumer workflow's `if:` guard expects; the publish job is skipped
    // in that case, so there is no auth gate left to answer either.
    await emitPlanOutputs([], [], '/gha/output.txt');

    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it('is a no-op outside Actions, where $GITHUB_OUTPUT is unset', async () => {
    // A local `piot plan` has no output file; it must not need one, and
    // must not write to some other path.
    await emitPlanOutputs([row('lib-rust', 'crates')], [verdict('lib-rust', 'crates', 'publish')], undefined);
    await emitPlanOutputs([row('lib-rust', 'crates')], [verdict('lib-rust', 'crates', 'publish')], '');

    expect(appendFileMock).not.toHaveBeenCalled();
  });
});

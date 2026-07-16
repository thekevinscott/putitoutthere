/**
 * Integration test for the evidence-check gate (#445, epic #442).
 *
 * Drives the real `piot-ci evidence-check` dispatch in-process — `run()` from
 * `cli.ts` → `runEvidenceCheck` → the added-bullet parse → the (empty-needle)
 * poll → `decideEvidenceCheck` — with only the OS boundary mocked (the exec
 * seam for git/gh, the sleep seam, `node:fs/promises` for the CHANGELOG read).
 * Unlike `src/evidence-check/run.test.ts` (which mocks the decision helpers to
 * isolate wiring), this exercises the real cross-module decision, so the
 * end-to-end pass/fail output is asserted through the actual command.
 *
 * These scenarios have no `(verified by: …)` citations, so `citedRunNeedles`
 * is empty and `pollUntilResolved` returns without touching `gh` or `sleep`
 * (see poll.ts), and the gate skips the run query entirely. The live-run /
 * `gh api` polling path is covered at the unit tier (run.test.ts,
 * passed-evidence.test.ts).
 */

import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';
import { execCapture } from '../../src/utils/exec-capture.js';
import { sleep } from '../../src/utils/sleep.js';

vi.mock('../../src/utils/exec-capture.js');
vi.mock('../../src/utils/sleep.js');
vi.mock('node:fs/promises');

const exec = vi.mocked(execCapture);
const read = vi.mocked(readFile);
let out: string[];

beforeEach(() => {
  out = [];
  vi.mocked(sleep).mockResolvedValue(undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.BASE_SHA = 'base';
  process.env.HEAD_SHA = 'head';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BASE_SHA;
  delete process.env.HEAD_SHA;
});

// Serve the `git diff` of CHANGELOG.md and the CHANGELOG.md read. `gh` and
// `sleep` are stubbed defensively but must not be reached in these cases.
function repo({ diff, changelog }: { diff: string; changelog: string }): void {
  exec.mockImplementation((cmd) =>
    Promise.resolve({
      stdout: cmd === 'gh' ? '{"workflow_runs":[]}' : diff, // git diff (sleep/gh unreached with empty needles)
      stderr: '',
    }),
  );
  read.mockResolvedValue(changelog);
}

const evidenceCheck = (): Promise<number> => run(['node', 'piot-ci', 'evidence-check']);

describe('piot-ci evidence-check (integration)', async () => {
  it('passes with the success line when no Unreleased bullets were added', async () => {
    repo({ diff: '@@ -1,0 +2,1 @@\n+- new', changelog: '# Changelog\n## v1.0.0\n- old' });
    await expect(evidenceCheck()).resolves.toBe(0);
    expect(out.join('')).toBe('Evidence check passed for CHANGELOG.md additions between base and head.\n');
  });

  it('fails, flagging each added Unreleased bullet that lacks a verified-by clause', async () => {
    // Fixture mirrors added-bullets: bullets `- a` (line 2) and `- b` (line 3)
    // fall inside the Unreleased range; `- c` (line 5) is in a later section.
    repo({
      diff: '@@ -1,0 +2,2 @@\n+- a\n+- b\n@@ -3,0 +5,1 @@\n+- c',
      changelog: '## Unreleased\n- a\n- b\n## v1\n- c',
    });
    await expect(evidenceCheck()).resolves.toBe(1);
    expect(out.join('')).toBe(
      [
        "::error::CHANGELOG.md:2: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
        "::error::CHANGELOG.md:3: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
        '',
      ].join('\n'),
    );
  });

  it('fails clearly and never shells out when BASE_SHA is unset', async () => {
    delete process.env.BASE_SHA;
    await expect(evidenceCheck()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::evidence-check: BASE_SHA and HEAD_SHA must be set.\n');
    expect(exec).not.toHaveBeenCalled();
  });
});

/**
 * Integration test for the tdd-lint gate (#452, epic #442).
 *
 * Drives the real `piot-ci tdd-lint` dispatch in-process — `run()` from
 * `cli.ts` → `runTddLint` → `decideTddLint` — with only the git-subprocess
 * boundary (the exec seam) mocked. Unlike `src/tdd-lint/run.test.ts`
 * (which also mocks `decide` to isolate the composition root's wiring), this
 * exercises the real decision, so the end-to-end output the workflow relies
 * on — the `::notice` bypass, the `::error` block, the OK/skip messages — is
 * asserted through the actual command a maintainer would run.
 */

import type * as ChildProcess from 'node:child_process';
import { execFile } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam) for real and mock
// only the Node built-in underneath it: `execFile` (what `execCapture` uses).
// Mocking the seam module itself would trip the testing-conventions
// `no-first-party-mock` gate.
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execFileMock = vi.mocked(execFile);
let out: string[];

beforeEach(() => {
  out = [];
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

// Serve the two git reads the gate performs, routed by subcommand. Mock at
// `execFile` (under `execCapture`) — the callback shape `execCapture` reads is
// `(err, stdout, stderr)`.
function git({ log = '', changed = '' }: { log?: string; changed?: string }): void {
  execFileMock.mockImplementation(((_cmd: string, args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const a = [...(args ?? [])].join(' ');
    cb(null, a.includes('log') ? log : changed, '');
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
}

const tddLint = (): Promise<number> => run(['node', 'piot-ci', 'tdd-lint']);

describe('piot-ci tdd-lint (integration)', async () => {
  it('passes when a src change ships a matching *.test.ts', async () => {
    git({ changed: 'packages/engine/src/plan.ts\npackages/engine/src/plan.test.ts\n' });
    await expect(tddLint()).resolves.toBe(0);
    expect(out.join('')).toBe('OK: src/ changes include *.test.ts updates.\n');
  });

  it('fails, listing the offending files, when a src change ships no test', async () => {
    git({ changed: 'packages/engine/src/plan.ts\npackages/engine/src/config.ts\n' });
    await expect(tddLint()).resolves.toBe(1);
    expect(out.join('')).toBe(
      [
        '::error::src/ changes detected without matching *.test.ts changes.',
        'PR modifies:',
        '  packages/engine/src/plan.ts',
        '  packages/engine/src/config.ts',
        '',
        'Write a failing test first (red) then implement it (green).',
        'See plan.md §23.7. Or add a `Skip-Gates: <reason>` trailer to any commit in this PR to bypass (notes/gates.md).',
        '',
      ].join('\n'),
    );
  });

  it('is bypassed with a ::notice when a commit carries a Skip-Gates trailer', async () => {
    git({ log: 'feat: risky\n\nSkip-Gates: emergency hotfix\n', changed: 'packages/engine/src/plan.ts\n' });
    await expect(tddLint()).resolves.toBe(0);
    expect(out.join('')).toBe('::notice title=TDD lint bypassed::Skip-Gates: emergency hotfix\n');
  });

  it('skips (exit 0) when the PR touches no engine src', async () => {
    git({ changed: '' });
    await expect(tddLint()).resolves.toBe(0);
    expect(out.join('')).toBe('No src/ changes in this PR -- skipping TDD lint.\n');
  });
});

/**
 * Integration test for the tdd-lint gate (#452, epic #442).
 *
 * Drives the real `piot-ci tdd-lint` dispatch in-process — `run()` from
 * `cli.ts` → `runTddLint` → `decideTddLint` — with only the git-subprocess
 * boundary (`node:child_process`) mocked. Unlike `src/tdd-lint/run.test.ts`
 * (which also mocks `decide` to isolate the composition root's wiring), this
 * exercises the real decision, so the end-to-end output the workflow relies
 * on — the `::notice` bypass, the `::error` block, the OK/skip messages — is
 * asserted through the actual command a maintainer would run.
 */

import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process');

const exec = vi.mocked(execFileSync);
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

// Serve the two git reads the gate performs, routed by subcommand.
function git({ log = '', changed = '' }: { log?: string; changed?: string }): void {
  exec.mockImplementation((_cmd, args) => {
    const a = (args as readonly string[]).join(' ');
    return a.includes('log') ? log : changed;
  });
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

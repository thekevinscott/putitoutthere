/**
 * Integration test for the actionlint id-token gate (#452, epic #442).
 *
 * Drives the real `piot-ci actionlint-idtoken` dispatch in-process — `run()`
 * from `cli.ts` → `runActionlintIdToken` → `decideActionlintIdToken` — with
 * only the filesystem boundary (`node:fs`) mocked. Unlike
 * `src/actionlint-idtoken/run.test.ts` (which also mocks `decide` to isolate
 * the composition root's wiring), this exercises the real matcher, so the
 * `grep -n` line-number echo and the `::error file=…` output the workflow
 * relies on are asserted through the actual command.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:fs');

const read = vi.mocked(readFileSync);
let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Serve each PR-time-path file its own YAML text; unmapped paths read empty.
function files(map: Record<string, string>): void {
  read.mockImplementation((path) => map[String(path)] ?? '');
}

const actionlint = (): number => run(['node', 'piot-ci', 'actionlint-idtoken']);

describe('piot-ci actionlint-idtoken (integration)', () => {
  it('passes (exit 0, no output) when no PR-time file grants id-token: write', () => {
    files({
      '.github/workflows/build.yml': 'permissions:\n  contents: read\n',
      '.github/workflows/_matrix.yml': 'jobs:\n  build:\n    runs-on: ubuntu-latest\n',
      '.github/workflows/check.yml': 'permissions:\n  contents: read\n',
    });
    expect(actionlint()).toBe(0);
    expect(out.join('')).toBe('');
  });

  it('fails, echoing the line number and an ::error, when a file grants id-token: write', () => {
    files({
      '.github/workflows/build.yml': 'permissions:\n  contents: read\n',
      '.github/workflows/_matrix.yml': 'permissions:\n  id-token: write\n',
      '.github/workflows/check.yml': 'permissions:\n  contents: read\n',
    });
    expect(actionlint()).toBe(1);
    expect(out.join('')).toBe(
      '2:  id-token: write\n' +
        '::error file=.github/workflows/_matrix.yml::id-token: write is forbidden on the PR-time path (issues #272, #317)\n',
    );
  });

  it('does not match an in-comment mention of id-token: write', () => {
    files({
      '.github/workflows/build.yml': '    # id-token: write (explained, not granted)\n',
      '.github/workflows/_matrix.yml': 'jobs: {}\n',
      '.github/workflows/check.yml': 'jobs: {}\n',
    });
    expect(actionlint()).toBe(0);
    expect(out.join('')).toBe('');
  });
});

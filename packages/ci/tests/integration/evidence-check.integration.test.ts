/**
 * Integration test for the evidence-check gate (#445, epic #442; fragments
 * #730). Drives the real `piot-ci evidence-check` dispatch in-process with
 * only the OS boundary mocked. These scenarios carry no `(verified by: …)`
 * citations, so the poll returns without touching `gh` or `sleep`; that path
 * is covered at unit tier.
 */

import type * as ChildProcess from 'node:child_process';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam + the real `sleep`)
// for real and mock only the Node built-in underneath: `execFile` (what
// `execCapture` uses). These scenarios cite no evidence, so `citedRunNeedles`
// is empty and `pollUntilResolved` returns before ever awaiting `sleep` — the
// real `sleep` is left un-mocked (mocking it would trip the
// testing-conventions `no-first-party-mock` gate) and is simply never reached.
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});
vi.mock('node:fs/promises');

const execFileMock = vi.mocked(execFile);
const read = vi.mocked(readFile);
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

// `files` maps each path the PR added under changelog.d/ to its content. The
// `git diff --diff-filter=A` lists them; any other git read sees nothing, and
// a read of a path not in the map resolves empty. `gh` is stubbed defensively
// but must not be reached in these cases.
function repo(files: Record<string, string>): void {
  execFileMock.mockImplementation(((cmd: string, args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    if (cmd === 'gh') {
      cb(null, '{"workflow_runs":[]}', '');
    } else {
      cb(null, [...(args ?? [])].includes('--diff-filter=A') ? Object.keys(files).join('\n') : '', '');
    }
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
  read.mockImplementation((path) => Promise.resolve(files[String(path)] ?? ''));
}

const evidenceCheck = (): Promise<number> => run(['node', 'piot-ci', 'evidence-check']);

const PASSED = 'Evidence check passed for changelog.d/ fragments added between base and head.\n';

describe('piot-ci evidence-check (integration)', async () => {
  it('passes with the success line when no fragment was added', async () => {
    repo({});
    await expect(evidenceCheck()).resolves.toBe(0);
    expect(out.join('')).toBe(PASSED);
  });

  it('passes an added fragment whose bullet carries a reasoned no-fixture clause', async () => {
    repo({ 'changelog.d/2026-10-05-rename.md': '- Changed: internal rename. (no fixture: pure refactor)\n' });
    await expect(evidenceCheck()).resolves.toBe(0);
    expect(out.join('')).toBe(PASSED);
  });

  it('flags, by fragment path and line, each bullet that lacks an evidence clause', async () => {
    repo({
      'changelog.d/2026-10-05-a.md': '- Fixed: a\n\n- Fixed: b (no fixture: internal)\n- Fixed: c\n',
      'changelog.d/2026-10-05-b.md': 'Prose before.\n- Added: d\n',
    });
    await expect(evidenceCheck()).resolves.toBe(1);
    expect(out.join('')).toBe(
      [
        "::error::changelog.d/2026-10-05-a.md:1: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
        "::error::changelog.d/2026-10-05-a.md:4: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
        "::error::changelog.d/2026-10-05-b.md:2: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
        '',
      ].join('\n'),
    );
  });

  it('flags an empty no-fixture reason with the fragment path', async () => {
    repo({ 'changelog.d/2026-10-05-a.md': '- Changed: x (no fixture: )\n' });
    await expect(evidenceCheck()).resolves.toBe(1);
    expect(out.join('')).toBe(
      "::error::changelog.d/2026-10-05-a.md:1: '(no fixture: ...)' requires a non-empty reason\n",
    );
  });

  it('fails a fragment with no bullet, since there is nothing to carry the clause', async () => {
    repo({ 'changelog.d/2026-10-05-a.md': 'Fixed: prose only. (no fixture: internal)\n' });
    await expect(evidenceCheck()).resolves.toBe(1);
    expect(out.join('')).toBe(
      "::error::changelog.d/2026-10-05-a.md: no '- ' bullet; each changelog entry is a bullet ending in its evidence clause\n",
    );
  });

  it("ignores the folder's README.md", async () => {
    repo({ 'changelog.d/README.md': '- Lead with the category\n' });
    await expect(evidenceCheck()).resolves.toBe(0);
    expect(out.join('')).toBe(PASSED);
  });

  it('fails clearly and never shells out when BASE_SHA is unset', async () => {
    delete process.env.BASE_SHA;
    await expect(evidenceCheck()).resolves.toBe(1);
    expect(out.join('')).toBe('::error::evidence-check: BASE_SHA and HEAD_SHA must be set.\n');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

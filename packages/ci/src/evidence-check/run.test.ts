/**
 * Composition-root coverage for the evidence-check gate (#445). The decision
 * modules (addedUnreleasedBullets, citedRunNeedles, decideEvidenceCheck,
 * pollUntilResolved, passedEvidence) and the I/O boundary (the exec seam, the
 * sleep seam, node:fs/promises) are mocked, so this isolates run's wiring: the
 * env guard, the exact `git diff` invocation, the CHANGELOG.md read, how
 * git/file output is parsed into decide()'s input, the exact poll deps
 * (deadline magnitude + the injected clock/sleep/log and the gh-api reader that
 * prefetches jobs so `jobsForRun` stays a sync cache read), and how decide()'s
 * lines + exit code surface. The decisions themselves live in their own tests.
 */
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { sleep } from '../utils/sleep.js';
import { addedUnreleasedBullets } from './added-bullets.js';
import { citedRunNeedles } from './cited-needles.js';
import { decideEvidenceCheck } from './decide.js';
import { passedEvidence } from './passed-evidence.js';
import { pollUntilResolved } from './poll.js';
import { runEvidenceCheck } from './run.js';

vi.mock('../utils/exec-capture.js');
vi.mock('../utils/sleep.js');
vi.mock('node:fs/promises');
vi.mock('./added-bullets.js');
vi.mock('./cited-needles.js');
vi.mock('./decide.js');
vi.mock('./poll.js');
vi.mock('./passed-evidence.js');

const exec = vi.mocked(execCapture);
const readFileMock = vi.mocked(readFile);
const sleepMock = vi.mocked(sleep);
const addedBullets = vi.mocked(addedUnreleasedBullets);
const needles = vi.mocked(citedRunNeedles);
const decide = vi.mocked(decideEvidenceCheck);
const poll = vi.mocked(pollUntilResolved);
const passed = vi.mocked(passedEvidence);

const out: string[] = [];

/** Route execCapture by command; `gh` is further routed by the api path. */
function routeExec(map: { git?: string; runs?: string; jobs?: string }): void {
  exec.mockImplementation((cmd, args) => {
    const argv = args ?? [];
    if (cmd === 'gh') {
      const path = argv[3] ?? '';
      const stdout = path.includes('/jobs') ? (map.jobs ?? '{"jobs":[]}') : (map.runs ?? '{"workflow_runs":[]}');
      return Promise.resolve({ stdout, stderr: '' });
    }
    return Promise.resolve({ stdout: cmd === 'git' ? (map.git ?? '') : '', stderr: '' });
  });
}

const runsQueryCount = (): number =>
  exec.mock.calls.filter(([cmd, args]) => cmd === 'gh' && (args ?? [])[3]?.includes('head_sha')).length;
const jobsQueryCount = (): number =>
  exec.mock.calls.filter(([cmd, args]) => cmd === 'gh' && (args ?? [])[3]?.includes('/jobs')).length;

beforeEach(() => {
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  process.env.BASE_SHA = 'aaaa';
  process.env.HEAD_SHA = 'bbbb';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  routeExec({ git: '' });
  readFileMock.mockResolvedValue('## Unreleased\n- x\n');
  sleepMock.mockResolvedValue(undefined);
  addedBullets.mockReturnValue([{ line: 2, text: '- x' }]);
  needles.mockReturnValue(new Set(['unit/x']));
  decide.mockReturnValue({ exitCode: 0, lines: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BASE_SHA;
  delete process.env.HEAD_SHA;
  delete process.env.GITHUB_REPOSITORY;
});

describe('runEvidenceCheck: environment guard', () => {
  it.each(['BASE_SHA', 'HEAD_SHA'])('fails clearly and does no I/O when %s is absent', async (key) => {
    delete process.env[key];
    const code = await runEvidenceCheck();
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::evidence-check: BASE_SHA and HEAD_SHA must be set.\n');
    expect(exec).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
    expect(addedBullets).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it.each(['BASE_SHA', 'HEAD_SHA'])('fails clearly when %s is the empty string', async (key) => {
    process.env[key] = '';
    await expect(runEvidenceCheck()).resolves.toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('runEvidenceCheck: input gathering', () => {
  it('diffs CHANGELOG.md between the SHAs and reads it, feeding split lines to addedUnreleasedBullets', async () => {
    routeExec({ git: 'HUNK\n+- a\n' });
    readFileMock.mockResolvedValue('## Unreleased\n- a\n');
    await runEvidenceCheck();

    expect(exec).toHaveBeenNthCalledWith(1, 'git', ['diff', '--unified=0', 'aaaa', 'bbbb', '--', 'CHANGELOG.md']);
    expect(readFileMock).toHaveBeenCalledWith('CHANGELOG.md', 'utf8');
    expect(addedBullets).toHaveBeenCalledWith(['## Unreleased', '- a', ''], ['HUNK', '+- a', '']);
  });
});

describe('runEvidenceCheck: orchestration', () => {
  it('polls the cited needles with the 20-minute deadline and injected deps', async () => {
    const bullets = [{ line: 2, text: '- x (verified by: unit/x)' }];
    const needleSet = new Set(['unit/x']);
    addedBullets.mockReturnValue(bullets);
    needles.mockReturnValue(needleSet);

    await runEvidenceCheck();

    expect(needles).toHaveBeenCalledWith(bullets);
    const pollArg = poll.mock.calls[0]?.[0];
    expect(pollArg?.needles).toBe(needleSet);
    expect(pollArg?.deadlineMs).toBe(20 * 60 * 1000);
    expect(typeof pollArg?.now).toBe('function');
    expect(typeof pollArg?.sleep).toBe('function');
    expect(typeof pollArg?.log).toBe('function');
    expect(typeof pollArg?.loadRuns).toBe('function');
    expect(typeof pollArg?.jobsForRun).toBe('function');
    expect(typeof pollArg?.resetCaches).toBe('function');
  });

  it('feeds the bullets + SHAs to decide, writes its lines, and returns its exit code', async () => {
    const bullets = [{ line: 2, text: '- x' }];
    addedBullets.mockReturnValue(bullets);
    decide.mockReturnValue({ exitCode: 1, lines: ['::error::boom', 'done'] });

    const code = await runEvidenceCheck();

    expect(code).toBe(1);
    const decideArg = decide.mock.calls[0]?.[0];
    expect(decideArg?.bullets).toBe(bullets);
    expect(decideArg?.baseSha).toBe('aaaa');
    expect(decideArg?.headSha).toBe('bbbb');
    expect(typeof decideArg?.passedEvidence).toBe('function');
    expect(out.join('')).toBe('::error::boom\ndone\n');
  });

  it('returns 0 and writes nothing extra when decide passes with no lines', async () => {
    decide.mockReturnValue({ exitCode: 0, lines: [] });
    await expect(runEvidenceCheck()).resolves.toBe(0);
    expect(out.join('')).toBe('');
  });

  it('never queries gh when there are no cited needles (nothing reaches passedEvidence)', async () => {
    needles.mockReturnValue(new Set());
    await runEvidenceCheck();
    // The git diff still runs; no gh runs/jobs query is issued.
    expect(exec).not.toHaveBeenCalledWith('gh', expect.anything());
    // The predicate is bound over an empty run set (never fetched).
    decide.mock.calls[0]?.[0].passedEvidence('unit/x');
    expect(passed).toHaveBeenCalledWith('unit/x', [], expect.any(Function));
  });
});

describe('runEvidenceCheck: gh api failure diagnostics', () => {
  it('surfaces the captured gh stderr when a query fails', async () => {
    exec.mockImplementation((cmd) =>
      cmd === 'git'
        ? Promise.resolve({ stdout: '', stderr: '' })
        : Promise.reject(new ExecError('gh failed', '', 'HTTP 404: not found', 1)),
    );
    await expect(runEvidenceCheck()).rejects.toThrow(/failed: HTTP 404: not found/);
  });

  it('surfaces an empty stderr when the gh failure is not an ExecError', async () => {
    exec.mockImplementation((cmd) =>
      cmd === 'git' ? Promise.resolve({ stdout: '', stderr: '' }) : Promise.reject(new Error('plain boom')),
    );
    await expect(runEvidenceCheck()).rejects.toThrow(/failed: $/);
  });
});

describe('runEvidenceCheck: injected poll dependencies', () => {
  async function pollDeps(): Promise<Parameters<typeof pollUntilResolved>[0]> {
    await runEvidenceCheck();
    const call = poll.mock.calls[0];
    if (call === undefined) {
      throw new Error('pollUntilResolved was not called');
    }
    return call[0];
  }

  it('now() reads the wall clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(424242);
    expect((await pollDeps()).now()).toBe(424242);
  });

  it('log() writes the message with a trailing newline', async () => {
    (await pollDeps()).log('a poll message');
    expect(out.join('')).toContain('a poll message\n');
  });

  it('sleep() waits 30 seconds through the sleep seam', async () => {
    await (await pollDeps()).sleep();
    expect(sleepMock).toHaveBeenCalledWith(30 * 1000);
  });

  it('loadRuns() queries the head SHA once and caches the workflow_runs', async () => {
    routeExec({
      runs: '{"workflow_runs":[{"id":9,"status":"completed","conclusion":"success","name":"unit"}]}',
    });
    const deps = await pollDeps();

    await expect(deps.loadRuns()).resolves.toEqual([
      { id: 9, status: 'completed', conclusion: 'success', name: 'unit' },
    ]);
    expect(exec).toHaveBeenCalledWith('gh', [
      'api',
      '-X',
      'GET',
      'repos/owner/repo/actions/runs?head_sha=bbbb&per_page=100',
    ]);
    const after = runsQueryCount();
    await expect(deps.loadRuns()).resolves.toEqual([
      { id: 9, status: 'completed', conclusion: 'success', name: 'unit' },
    ]);
    expect(runsQueryCount()).toBe(after);
  });

  it('loadRuns() defaults to [] when the response has no workflow_runs', async () => {
    routeExec({ runs: '{}' });
    await expect((await pollDeps()).loadRuns()).resolves.toEqual([]);
  });

  it('jobsForRun() reads a run’s prefetched jobs from the cache (sync, no extra query)', async () => {
    routeExec({ runs: '{"workflow_runs":[{"id":9}]}', jobs: '{"jobs":[{"name":"integration"}]}' });
    const deps = await pollDeps();

    // loadRuns prefetched run 9's jobs; jobsForRun is a sync cache read.
    expect(deps.jobsForRun(9)).toEqual([{ name: 'integration' }]);
    expect(exec).toHaveBeenCalledWith('gh', [
      'api',
      '-X',
      'GET',
      'repos/owner/repo/actions/runs/9/jobs?per_page=100',
    ]);
    const after = jobsQueryCount();
    expect(deps.jobsForRun(9)).toEqual([{ name: 'integration' }]);
    expect(jobsQueryCount()).toBe(after);
  });

  it('jobsForRun() yields [] when a prefetched run’s jobs response has none', async () => {
    routeExec({ runs: '{"workflow_runs":[{"id":3}]}', jobs: '{}' });
    expect((await pollDeps()).jobsForRun(3)).toEqual([]);
  });

  it('prefetches each run id once, skipping a duplicate id in the same response', async () => {
    // Two runs share id 9: the prefetch loop fetches its jobs on the first
    // entry, then the `jobsByRun.has(run.id)` guard skips the second — one
    // jobs query, not two.
    routeExec({
      runs: '{"workflow_runs":[{"id":9},{"id":9}]}',
      jobs: '{"jobs":[{"name":"integration"}]}',
    });
    const deps = await pollDeps();

    await deps.loadRuns();
    expect(jobsQueryCount()).toBe(1);
    expect(deps.jobsForRun(9)).toEqual([{ name: 'integration' }]);
  });

  it('jobsForRun() yields [] for a run id absent from the cache', async () => {
    expect((await pollDeps()).jobsForRun(999)).toEqual([]);
  });

  it('resetCaches() forces the next loadRuns() to re-query', async () => {
    routeExec({ runs: '{"workflow_runs":[]}' });
    const deps = await pollDeps();

    await deps.loadRuns();
    const before = runsQueryCount();
    deps.resetCaches();
    await deps.loadRuns();
    expect(runsQueryCount()).toBe(before + 1);
  });
});

describe('runEvidenceCheck: decide passedEvidence predicate', () => {
  it('binds passedEvidence to the current runs and the job reader', async () => {
    routeExec({ runs: '{"workflow_runs":[{"id":9,"status":"completed","conclusion":"success","name":"unit"}]}' });
    passed.mockReturnValue(true);
    await runEvidenceCheck();
    const decideCall = decide.mock.calls[0];
    if (decideCall === undefined) {
      throw new Error('decideEvidenceCheck was not called');
    }

    const result = decideCall[0].passedEvidence('unit/x');

    expect(result).toBe(true);
    expect(passed).toHaveBeenCalledWith(
      'unit/x',
      [{ id: 9, status: 'completed', conclusion: 'success', name: 'unit' }],
      expect.any(Function),
    );
  });
});

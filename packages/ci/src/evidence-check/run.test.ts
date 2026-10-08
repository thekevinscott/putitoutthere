/**
 * Composition-root coverage for the evidence-check gate (#445). Every decision
 * module and the I/O boundary are mocked, so this isolates run's wiring: the
 * env guard, the exact `git diff` of added fragments, the poll deps (deadline
 * magnitude, injected clock/sleep/log, the gh-api prefetch that keeps
 * `jobsForRun` a sync read).
 */
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';

vi.mock('../utils/exec-error.js', async () => await vi.importActual<typeof import('../utils/exec-error.js')>('../utils/exec-error.js'));
import { sleep } from '../utils/sleep.js';
import { fragmentBullets } from './fragment-bullets.js';
import { citedRunNeedles } from './cited-needles.js';
import { decideEvidenceCheck } from './decide.js';
import { passedEvidence } from './passed-evidence.js';
import { pollUntilResolved } from './poll.js';
import { runEvidenceCheck } from './run.js';

vi.mock('../utils/exec-capture.js');
vi.mock('../utils/sleep.js');
vi.mock('node:fs/promises');
vi.mock('./fragment-bullets.js');
vi.mock('./cited-needles.js');
vi.mock('./decide.js');
vi.mock('./poll.js');
vi.mock('./passed-evidence.js');

const exec = vi.mocked(execCapture);
const readFileMock = vi.mocked(readFile);
const sleepMock = vi.mocked(sleep);
const bulletsOf = vi.mocked(fragmentBullets);
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
  readFileMock.mockResolvedValue('- x\n');
  sleepMock.mockResolvedValue(undefined);
  bulletsOf.mockReturnValue([]);
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
    expect(bulletsOf).not.toHaveBeenCalled();
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
  it('lists the fragments added under changelog.d/ between the SHAs and reads each one', async () => {
    routeExec({ git: 'changelog.d/2026-10-05-a.md\r\nchangelog.d/README.md\nchangelog.d/2026-10-05-b.md\n' });
    readFileMock.mockImplementation((path) => Promise.resolve(`content of ${path as string}`));
    await runEvidenceCheck();

    expect(exec).toHaveBeenNthCalledWith(1, 'git', [
      'diff',
      '--name-only',
      '--diff-filter=A',
      'aaaa',
      'bbbb',
      '--',
      'changelog.d/',
    ]);
    expect(readFileMock.mock.calls).toEqual([
      ['changelog.d/2026-10-05-a.md', 'utf8'],
      ['changelog.d/2026-10-05-b.md', 'utf8'],
    ]);
    expect(bulletsOf.mock.calls).toEqual([
      ['changelog.d/2026-10-05-a.md', 'content of changelog.d/2026-10-05-a.md'],
      ['changelog.d/2026-10-05-b.md', 'content of changelog.d/2026-10-05-b.md'],
    ]);
  });
});

describe('runEvidenceCheck: orchestration', () => {
  it('polls the needles cited across every fragment with the 20-minute deadline and injected deps', async () => {
    routeExec({ git: 'changelog.d/2026-10-05-a.md\nchangelog.d/2026-10-05-b.md\n' });
    const a = [{ path: 'changelog.d/2026-10-05-a.md', line: 1, text: '- x (verified by: unit/x)' }];
    const b = [{ path: 'changelog.d/2026-10-05-b.md', line: 3, text: '- y (verified by: unit/y)' }];
    bulletsOf.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const needleSet = new Set(['unit/x']);
    needles.mockReturnValue(needleSet);

    await runEvidenceCheck();

    expect(needles).toHaveBeenCalledWith([...a, ...b]);
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

  it('feeds the fragments + SHAs to decide, writes its lines, and returns its exit code', async () => {
    routeExec({ git: 'changelog.d/2026-10-05-a.md\n' });
    const bullets = [{ path: 'changelog.d/2026-10-05-a.md', line: 2, text: '- x' }];
    bulletsOf.mockReturnValue(bullets);
    decide.mockReturnValue({ exitCode: 1, lines: ['::error::boom', 'done'] });

    const code = await runEvidenceCheck();

    expect(code).toBe(1);
    const decideArg = decide.mock.calls[0]?.[0];
    expect(decideArg?.fragments).toEqual([{ path: 'changelog.d/2026-10-05-a.md', bullets }]);
    expect(decideArg?.fragments[0]?.bullets).toBe(bullets);
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
    const ghErr = new ExecError('gh failed', '', 'HTTP 404: not found', 1);
    exec.mockImplementation((cmd) =>
      cmd === 'git' ? Promise.resolve({ stdout: '', stderr: '' }) : Promise.reject(ghErr),
    );
    let caught: unknown;
    try {
      await runEvidenceCheck();
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toMatch(/failed: HTTP 404: not found/);
    // The original gh failure is chained as `cause` for diagnosability.
    expect((caught as Error).cause).toBe(ghErr);
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
      'repos/owner/repo/actions/runs/9/jobs?per_page=100&page=1',
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

describe('runEvidenceCheck: transient gh api failures (#613)', () => {
  const transient = new ExecError('gh failed', '', 'gh: Server Error (HTTP 502)', 1);

  /** gh rejects `failures` times, then serves empty runs/jobs payloads. */
  function routeExecFlaky(failures: number): () => number {
    let remaining = failures;
    let ghCalls = 0;
    exec.mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      ghCalls += 1;
      if (remaining > 0) {
        remaining -= 1;
        return Promise.reject(transient);
      }
      const path = (args ?? [])[3] ?? '';
      const stdout = path.includes('/jobs') ? '{"jobs":[]}' : '{"workflow_runs":[]}';
      return Promise.resolve({ stdout, stderr: '' });
    });
    return () => ghCalls;
  }

  it('retries a query that fails once with a 5xx and succeeds, backing off 2s', async () => {
    routeExecFlaky(1);
    await expect(runEvidenceCheck()).resolves.toBe(0);
    expect(sleepMock).toHaveBeenCalledWith(2000);
  });

  it('doubles the backoff between consecutive 5xx retries', async () => {
    routeExecFlaky(2);
    await expect(runEvidenceCheck()).resolves.toBe(0);
    expect(sleepMock.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000]);
  });

  it('gives up after 4 attempts, surfacing the last 5xx stderr', async () => {
    const ghCalls = routeExecFlaky(Number.POSITIVE_INFINITY);
    await expect(runEvidenceCheck()).rejects.toThrow(/failed: gh: Server Error \(HTTP 502\)/);
    expect(ghCalls()).toBe(4);
    expect(sleepMock.mock.calls.map(([ms]) => ms)).toEqual([2000, 4000, 8000]);
  });
});

describe('runEvidenceCheck: jobs pagination (#613)', () => {
  it('follows the jobs listing past a full first page', async () => {
    // A run with 101 jobs: page 1 returns a full 100-job page, so the
    // prefetch must request page 2 to see the 101st job — the shape of the
    // 116-job e2e run that made a citation invisible under per_page=100.
    const fullPage = JSON.stringify({
      jobs: Array.from({ length: 100 }, (_, i) => ({ name: `job-${String(i)}` })),
    });
    exec.mockImplementation((cmd, args) => {
      if (cmd !== 'gh') {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      const path = (args ?? [])[3] ?? '';
      if (path.includes('/jobs')) {
        const stdout = path.includes('page=2') ? '{"jobs":[{"name":"job-100"}]}' : fullPage;
        return Promise.resolve({ stdout, stderr: '' });
      }
      return Promise.resolve({ stdout: '{"workflow_runs":[{"id":9}]}', stderr: '' });
    });

    await runEvidenceCheck();
    const deps = poll.mock.calls[0]?.[0];
    if (deps === undefined) {
      throw new Error('pollUntilResolved was not called');
    }
    await deps.loadRuns();

    expect(deps.jobsForRun(9)).toHaveLength(101);
    expect(deps.jobsForRun(9)[100]).toEqual({ name: 'job-100' });
    expect(jobsQueryCount()).toBe(2);
  });

  it('stops at a short page without requesting another', async () => {
    routeExec({ runs: '{"workflow_runs":[{"id":9}]}', jobs: '{"jobs":[{"name":"integration"}]}' });
    await runEvidenceCheck();
    expect(jobsQueryCount()).toBe(1);
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

/**
 * Composition-root coverage for the evidence-check gate (#445). The decision
 * modules (addedUnreleasedBullets, citedRunNeedles, decideEvidenceCheck,
 * pollUntilResolved, passedEvidence) and the I/O boundary (node:child_process,
 * node:fs) are mocked, so this isolates run's wiring: the env guard, the exact
 * `git diff` invocation, the CHANGELOG.md read, how git/file output is parsed
 * into decide()'s input, the exact poll deps (deadline magnitude + the
 * injected clock/sleep/log and cached gh-api readers), and how decide()'s
 * lines + exit code surface. The decisions themselves live in their own tests.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addedUnreleasedBullets } from './added-bullets.js';
import { citedRunNeedles } from './cited-needles.js';
import { decideEvidenceCheck } from './decide.js';
import { passedEvidence } from './passed-evidence.js';
import { pollUntilResolved } from './poll.js';
import { runEvidenceCheck } from './run.js';

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('./added-bullets.js');
vi.mock('./cited-needles.js');
vi.mock('./decide.js');
vi.mock('./poll.js');
vi.mock('./passed-evidence.js');

const exec = vi.mocked(execFileSync);
const readFile = vi.mocked(readFileSync);
const addedBullets = vi.mocked(addedUnreleasedBullets);
const needles = vi.mocked(citedRunNeedles);
const decide = vi.mocked(decideEvidenceCheck);
const poll = vi.mocked(pollUntilResolved);
const passed = vi.mocked(passedEvidence);

const out: string[] = [];

/** Route execFileSync by command; `gh` is further routed by the api path. */
function routeExec(map: { git?: string; runs?: string; jobs?: string }): void {
  exec.mockImplementation((cmd, args) => {
    const argv = args ?? [];
    if (cmd === 'gh') {
      const path = argv[3] ?? '';
      return path.includes('/jobs') ? (map.jobs ?? '{"jobs":[]}') : (map.runs ?? '{"workflow_runs":[]}');
    }
    return cmd === 'git' ? (map.git ?? '') : '';
  });
}

const runsQueryCount = (): number =>
  exec.mock.calls.filter(([cmd, args]) => cmd === 'gh' && ((args ?? []) as string[])[3]?.includes('head_sha')).length;
const jobsQueryCount = (): number =>
  exec.mock.calls.filter(([cmd, args]) => cmd === 'gh' && ((args ?? []) as string[])[3]?.includes('/jobs')).length;

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
  readFile.mockReturnValue('## Unreleased\n- x\n');
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
  it.each(['BASE_SHA', 'HEAD_SHA'])('fails clearly and does no I/O when %s is absent', (key) => {
    delete process.env[key];
    const code = runEvidenceCheck();
    expect(code).toBe(1);
    expect(out.join('')).toBe('::error::evidence-check: BASE_SHA and HEAD_SHA must be set.\n');
    expect(exec).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(addedBullets).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it.each(['BASE_SHA', 'HEAD_SHA'])('fails clearly when %s is the empty string', (key) => {
    process.env[key] = '';
    expect(runEvidenceCheck()).toBe(1);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('runEvidenceCheck: input gathering', () => {
  it('diffs CHANGELOG.md between the SHAs and reads it, feeding split lines to addedUnreleasedBullets', () => {
    routeExec({ git: 'HUNK\n+- a\n' });
    readFile.mockReturnValue('## Unreleased\n- a\n');
    runEvidenceCheck();

    expect(exec).toHaveBeenNthCalledWith(
      1,
      'git',
      ['diff', '--unified=0', 'aaaa', 'bbbb', '--', 'CHANGELOG.md'],
      { encoding: 'utf8' },
    );
    expect(readFile).toHaveBeenCalledWith('CHANGELOG.md', 'utf8');
    expect(addedBullets).toHaveBeenCalledWith(['## Unreleased', '- a', ''], ['HUNK', '+- a', '']);
  });
});

describe('runEvidenceCheck: orchestration', () => {
  it('polls the cited needles with the 20-minute deadline and injected deps', () => {
    const bullets = [{ line: 2, text: '- x (verified by: unit/x)' }];
    const needleSet = new Set(['unit/x']);
    addedBullets.mockReturnValue(bullets);
    needles.mockReturnValue(needleSet);

    runEvidenceCheck();

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

  it('feeds the bullets + SHAs to decide, writes its lines, and returns its exit code', () => {
    const bullets = [{ line: 2, text: '- x' }];
    addedBullets.mockReturnValue(bullets);
    decide.mockReturnValue({ exitCode: 1, lines: ['::error::boom', 'done'] });

    const code = runEvidenceCheck();

    expect(code).toBe(1);
    const decideArg = decide.mock.calls[0]?.[0];
    expect(decideArg?.bullets).toBe(bullets);
    expect(decideArg?.baseSha).toBe('aaaa');
    expect(decideArg?.headSha).toBe('bbbb');
    expect(typeof decideArg?.passedEvidence).toBe('function');
    expect(out.join('')).toBe('::error::boom\ndone\n');
  });

  it('returns 0 and writes nothing extra when decide passes with no lines', () => {
    decide.mockReturnValue({ exitCode: 0, lines: [] });
    expect(runEvidenceCheck()).toBe(0);
    expect(out.join('')).toBe('');
  });
});

describe('runEvidenceCheck: injected poll dependencies', () => {
  function pollDeps(): Parameters<typeof pollUntilResolved>[0] {
    runEvidenceCheck();
    const call = poll.mock.calls[0];
    if (call === undefined) {
      throw new Error('pollUntilResolved was not called');
    }
    return call[0];
  }

  it('now() reads the wall clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(424242);
    expect(pollDeps().now()).toBe(424242);
  });

  it('log() writes the message with a trailing newline', () => {
    pollDeps().log('a poll message');
    expect(out.join('')).toContain('a poll message\n');
  });

  it('sleep() sleeps for 30 seconds', () => {
    pollDeps().sleep();
    expect(exec).toHaveBeenCalledWith('sleep', ['30'], { stdio: 'ignore' });
  });

  it('loadRuns() queries the head SHA once and caches the workflow_runs', () => {
    routeExec({
      runs: '{"workflow_runs":[{"id":9,"status":"completed","conclusion":"success","name":"unit"}]}',
    });
    const deps = pollDeps();

    expect(deps.loadRuns()).toEqual([{ id: 9, status: 'completed', conclusion: 'success', name: 'unit' }]);
    expect(exec).toHaveBeenCalledWith(
      'gh',
      ['api', '-X', 'GET', 'repos/owner/repo/actions/runs?head_sha=bbbb&per_page=100'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const after = runsQueryCount();
    expect(deps.loadRuns()).toEqual([{ id: 9, status: 'completed', conclusion: 'success', name: 'unit' }]);
    expect(runsQueryCount()).toBe(after);
  });

  it('loadRuns() defaults to [] when the response has no workflow_runs', () => {
    routeExec({ runs: '{}' });
    expect(pollDeps().loadRuns()).toEqual([]);
  });

  it('jobsForRun() queries a run’s jobs once and caches them', () => {
    routeExec({ runs: '{"workflow_runs":[]}', jobs: '{"jobs":[{"name":"integration"}]}' });
    const deps = pollDeps();

    expect(deps.jobsForRun(9)).toEqual([{ name: 'integration' }]);
    expect(exec).toHaveBeenCalledWith(
      'gh',
      ['api', '-X', 'GET', 'repos/owner/repo/actions/runs/9/jobs?per_page=100'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const after = jobsQueryCount();
    expect(deps.jobsForRun(9)).toEqual([{ name: 'integration' }]);
    expect(jobsQueryCount()).toBe(after);
  });

  it('jobsForRun() defaults to [] when the response has no jobs', () => {
    routeExec({ jobs: '{}' });
    expect(pollDeps().jobsForRun(3)).toEqual([]);
  });

  it('resetCaches() forces the next loadRuns() to re-query', () => {
    routeExec({ runs: '{"workflow_runs":[]}' });
    const deps = pollDeps();

    deps.loadRuns();
    const before = runsQueryCount();
    deps.resetCaches();
    deps.loadRuns();
    expect(runsQueryCount()).toBe(before + 1);
  });
});

describe('runEvidenceCheck: decide passedEvidence predicate', () => {
  it('binds passedEvidence to the current runs and the job reader', () => {
    routeExec({ runs: '{"workflow_runs":[{"id":9,"status":"completed","conclusion":"success","name":"unit"}]}' });
    passed.mockReturnValue(true);
    runEvidenceCheck();
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

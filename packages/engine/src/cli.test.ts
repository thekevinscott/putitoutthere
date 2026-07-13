/**
 * Unit suite for the `putitoutthere` CLI dispatcher (`cli.ts`). Isolated
 * per the unit-suite convention: every engine collaborator the dispatcher
 * calls (`./plan-status.js`, `./check.js`, `./status.js`, `./publish.js`,
 * the `write-*` hooks) and the `node:fs` `$GITHUB_OUTPUT` sink are mocked,
 * so each test exercises only `run`'s routing / flag-validation / exit-code
 * / output-shape branching. The real engine behaviour those handlers carry
 * (actual version bumps, real drift detection, launcher authoring) is
 * covered at the integration and e2e-cli tiers — see AGENTS.md.
 *
 * `parseFlags` is exercised directly (it is `cli.ts`'s own pure code);
 * `./status-format.js` / `./version.js` stay real (pure, no I/O, and not
 * imported here) so the human-readable render is asserted end to end.
 */

import { appendFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFlags, run } from './cli.js';
import { runChecks } from './check.js';
import { computePlanStatus } from './plan-status.js';
import { publish } from './publish.js';
import { computeStatus } from './status.js';
import { writeCrateVersionForBuild } from './write-crate-version.js';
import { writeLauncherFromConfig } from './write-launcher.js';
import { writeVersionForBuild } from './write-version.js';
import type { CheckFinding } from './check.js';
import type { MatrixRow } from './plan.js';
import type { PlanStatus } from './plan-status-types.js';
import type { StatusRow } from './status-types.js';

vi.mock('node:fs');
vi.mock('./check.js');
vi.mock('./plan-status.js');
vi.mock('./publish.js');
vi.mock('./status.js');
vi.mock('./write-crate-version.js');
vi.mock('./write-launcher.js');
vi.mock('./write-version.js');

const runChecksMock = vi.mocked(runChecks);
const computePlanStatusMock = vi.mocked(computePlanStatus);
const publishMock = vi.mocked(publish);
const computeStatusMock = vi.mocked(computeStatus);
const writeCrateVersionMock = vi.mocked(writeCrateVersionForBuild);
const writeLauncherMock = vi.mocked(writeLauncherFromConfig);
const writeVersionMock = vi.mocked(writeVersionForBuild);
const appendFileSyncMock = vi.mocked(appendFileSync);

function matrixRow(name: string, version = '1.0.0'): MatrixRow {
  return {
    name,
    kind: 'npm',
    version,
    target: 'main',
    runs_on: 'ubuntu-latest',
    artifact_name: `${name}-artifact`,
    artifact_path: 'artifacts',
    path: 'packages/ts',
  };
}

function planStatus(rows: MatrixRow[]): PlanStatus {
  return {
    matrix: rows,
    verdicts: rows.map((r) => ({
      package: r.name,
      kind: r.kind,
      version: r.version,
      verdict: 'publish' as const,
    })),
    skew: [],
  };
}

function statusRow(overrides: Partial<StatusRow> = {}): StatusRow {
  return {
    package: 'demo-rust',
    kind: 'crates',
    tag: null,
    tagVersion: null,
    registry: '0.1.0',
    registryUnreachable: false,
    state: 'in sync',
    drift: false,
    ...overrides,
  };
}

const argv = (...rest: string[]) => ['node', 'putitoutthere', ...rest];

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  computePlanStatusMock.mockResolvedValue(planStatus([]));
  runChecksMock.mockReturnValue([]);
  computeStatusMock.mockResolvedValue([]);
  publishMock.mockResolvedValue({ ok: true, published: [] });
  writeVersionMock.mockReturnValue(['pyproject.toml']);
  writeCrateVersionMock.mockReturnValue(['Cargo.toml']);
  writeLauncherMock.mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GITHUB_OUTPUT;
});

describe('cli: top-level dispatch', () => {
  it('prints a short --help hint and exits 1 with no command (#150)', async () => {
    const code = await run(argv());
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/missing command/);
    expect(stderr.join('')).toMatch(/--help/);
  });

  it('prints usage and exits 0 for --help', async () => {
    const code = await run(argv('--help'));
    expect(code).toBe(0);
    expect(stderr.join('')).toMatch(/Usage:/);
  });

  it('--help description for --json is not stale (#231)', async () => {
    // Regression guard: the usage line for --json once read "(plan only)",
    // but the flag has been accepted on every command that emits a result
    // since their respective additions. Lock the corrected wording in so
    // a future edit can't quietly reintroduce the bug.
    const code = await run(argv('--help'));
    expect(code).toBe(0);
    const usage = stderr.join('');
    expect(usage).toMatch(/--json\s+emit machine-readable output/);
    expect(usage).not.toMatch(/--json[^\n]*plan only/);
  });

  it('prints version from package.json', async () => {
    const code = await run(argv('version'));
    expect(code).toBe(0);
    expect(stdout.join('')).toMatch(/putitoutthere \d+\.\d+\.\d+/);
  });

  it('exits 1 on unknown command', async () => {
    const code = await run(argv('foo'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/unknown command/);
  });

  it('surfaces engine errors with a non-zero exit and a friendly prefix', async () => {
    computePlanStatusMock.mockRejectedValue(new Error('boom'));
    const code = await run(argv('plan', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/^putitoutthere:/m);
  });

  it('rejects --dry-run on every command except reconcile (#244)', async () => {
    const code = await run(argv('publish', '--cwd', '/x', '--dry-run'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/--dry-run was removed/);
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe('parseFlags', () => {
  it('resolves a relative --cwd to an absolute path (#244)', () => {
    // Downstream handlers run subprocesses with `cwd: ctx.cwd` and pass
    // file paths derived from `join(cwd, 'artifacts', ...)`. If the parsed
    // cwd were left relative, those paths would re-resolve under the
    // subprocess's cwd and double-up the prefix. Anchor at parse time.
    const flags = parseFlags(['--cwd', 'fixture-tree']);
    expect(flags.cwd).not.toBe('fixture-tree');
    expect(flags.cwd.endsWith('fixture-tree')).toBe(true);
  });

  it('leaves an already-absolute --cwd untouched', () => {
    const flags = parseFlags(['--cwd', '/tmp/abs-path-test']);
    expect(flags.cwd).toBe('/tmp/abs-path-test');
  });

  it('parses --release-packages', () => {
    const flags = parseFlags(['--release-packages', 'lib-core@minor, lib-js']);
    expect(flags.releasePackages).toBe('lib-core@minor, lib-js');
  });

  it('leaves releasePackages undefined when --release-packages is absent', () => {
    const flags = parseFlags(['--cwd', '/tmp/x']);
    expect(flags.releasePackages).toBeUndefined();
  });
});

describe('cli: check dispatch', () => {
  it('exits 1 with a finding list when checks report findings (#319)', async () => {
    const findings: CheckFinding[] = [
      { message: 'putitoutthere.toml not found at /x/putitoutthere.toml' },
    ];
    runChecksMock.mockReturnValue(findings);
    const code = await run(argv('check', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/check: 1 finding/);
    expect(stderr.join('')).toMatch(/putitoutthere\.toml not found/);
  });

  it('exits 0 with a "no findings" line when checks pass', async () => {
    runChecksMock.mockReturnValue([]);
    const code = await run(argv('check', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(stdout.join('')).toMatch(/no findings/);
  });

  it('emits the findings array on stdout under --json', async () => {
    runChecksMock.mockReturnValue([{ message: 'putitoutthere.toml missing' }]);
    const code = await run(argv('check', '--cwd', '/x', '--json'));
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.join('').trim()) as {
      findings: Array<{ message: string }>;
    };
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(parsed.findings[0]!.message).toMatch(/putitoutthere\.toml/);
  });
});

describe('cli: status dispatch', () => {
  it('flags drift and exits non-zero under --check (--json)', async () => {
    computeStatusMock.mockResolvedValue([
      statusRow({ state: 'published, untagged', drift: true }),
    ]);
    const code = await run(argv('status', '--check', '--json', '--cwd', '/x'));
    const parsed = JSON.parse(stdout.join('').trim()) as Array<{
      package: string;
      state: string;
      drift: boolean;
    }>;
    expect(parsed[0]!.package).toBe('demo-rust');
    expect(parsed[0]!.state).toBe('published, untagged');
    expect(parsed[0]!.drift).toBe(true);
    expect(code).toBe(1);
  });

  it('renders a human-readable table and exits zero when in sync', async () => {
    computeStatusMock.mockResolvedValue([
      statusRow({ tag: 'demo-rust-v0.1.0', tagVersion: '0.1.0', state: 'in sync' }),
    ]);
    const code = await run(argv('status', '--check', '--cwd', '/x'));
    const out = stdout.join('');
    expect(out).toContain('demo-rust');
    expect(out).toContain('in sync');
    expect(code).toBe(0);
  });

  it('reports drift but keeps a zero exit without --check', async () => {
    computeStatusMock.mockResolvedValue([
      statusRow({ state: 'published, untagged', drift: true }),
    ]);
    const code = await run(argv('status', '--cwd', '/x'));
    expect(code).toBe(0);
  });
});

describe('cli: plan dispatch', () => {
  it('prints a human summary of the planned matrix by default', async () => {
    computePlanStatusMock.mockResolvedValue(planStatus([matrixRow('demo')]));
    const code = await run(argv('plan', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(stdout.join('')).toMatch(/demo/);
  });

  it('emits JSON on --json', async () => {
    computePlanStatusMock.mockResolvedValue(planStatus([matrixRow('demo')]));
    const code = await run(argv('plan', '--cwd', '/x', '--json'));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join('').trim()) as { matrix: Array<{ name: string }> };
    expect(parsed.matrix.map((r) => r.name)).toContain('demo');
  });

  it('forwards --release-packages to the planner', async () => {
    computePlanStatusMock.mockResolvedValue(planStatus([matrixRow('demo', '1.1.0')]));
    const code = await run(argv('plan', '--cwd', '/x', '--json', '--release-packages', 'demo@minor'));
    expect(code).toBe(0);
    expect(computePlanStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ releasePackages: 'demo@minor' }),
    );
    const parsed = JSON.parse(stdout.join('').trim()) as {
      matrix: Array<{ name: string; version: string }>;
    };
    expect(parsed.matrix[0]!.version).toBe('1.1.0');
  });

  it('appends matrix= to $GITHUB_OUTPUT when set and the plan is non-empty', async () => {
    computePlanStatusMock.mockResolvedValue(planStatus([matrixRow('demo')]));
    process.env.GITHUB_OUTPUT = '/gha/output.txt';
    const code = await run(argv('plan', '--cwd', '/x', '--json'));
    expect(code).toBe(0);
    expect(appendFileSyncMock).toHaveBeenCalledOnce();
    expect(appendFileSyncMock.mock.calls[0]![0]).toBe('/gha/output.txt');
    expect(String(appendFileSyncMock.mock.calls[0]![1])).toMatch(/^matrix=/);
  });

  it('does NOT write matrix= to $GITHUB_OUTPUT when the plan is empty (#146)', async () => {
    computePlanStatusMock.mockResolvedValue(planStatus([]));
    process.env.GITHUB_OUTPUT = '/gha/output.txt';
    const code = await run(argv('plan', '--cwd', '/x', '--json'));
    expect(code).toBe(0);
    expect(appendFileSyncMock).not.toHaveBeenCalled();
  });

  it('prints "no packages to release" when the plan is empty', async () => {
    computePlanStatusMock.mockResolvedValue(planStatus([]));
    const code = await run(argv('plan', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(stdout.join('')).toMatch(/no packages to release/);
  });
});

describe('cli: write-version dispatch', () => {
  it('routes to the engine with the resolved path and version', async () => {
    const code = await run(argv('write-version', '--path', '/pkg', '--version', '0.2.8'));
    expect(code).toBe(0);
    expect(writeVersionMock).toHaveBeenCalledWith('/pkg', '0.2.8');
    expect(stdout.join('')).toMatch(/write-version:/);
  });

  it('errors when --version is missing (#276)', async () => {
    const code = await run(argv('write-version', '--path', '/pkg'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/--version/);
    expect(writeVersionMock).not.toHaveBeenCalled();
  });

  it('errors when --path is missing (#276)', async () => {
    const code = await run(argv('write-version', '--version', '0.2.8'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/--path/);
    expect(writeVersionMock).not.toHaveBeenCalled();
  });
});

describe('cli: write-crate-version dispatch', () => {
  it('routes to the engine with the resolved path and version (#366)', async () => {
    const code = await run(argv('write-crate-version', '--path', '/crate', '--version', '0.3.5'));
    expect(code).toBe(0);
    expect(writeCrateVersionMock).toHaveBeenCalledWith('/crate', '0.3.5');
  });

  it('resolves a relative --path against --cwd (#366)', async () => {
    const code = await run(argv('write-crate-version', '--cwd', '/root', '--path', 'crate', '--version', '0.3.5'));
    expect(code).toBe(0);
    // The resolved target is OS-specific (`/root/crate` vs `\root\crate`);
    // assert the trailing segment separator-agnostically.
    expect(writeCrateVersionMock).toHaveBeenCalledWith(
      expect.stringMatching(/[/\\]crate$/),
      '0.3.5',
    );
  });

  it('errors when --path is missing (#366)', async () => {
    const code = await run(argv('write-crate-version', '--version', '0.3.5'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/--path/);
    expect(writeCrateVersionMock).not.toHaveBeenCalled();
  });

  it('errors when --version is missing (#366)', async () => {
    const code = await run(argv('write-crate-version', '--path', '/crate'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/--version/);
    expect(writeCrateVersionMock).not.toHaveBeenCalled();
  });
});

describe('cli: write-launcher dispatch', () => {
  it('reports the authored files when the engine writes a launcher (#299)', async () => {
    writeLauncherMock.mockReturnValue(['bin/demo-cli.js', 'package.json']);
    const code = await run(argv('write-launcher', '--cwd', '/tree', '--path', 'packages/ts'));
    expect(code).toBe(0);
    expect(writeLauncherMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/tree', packagePath: 'packages/ts' }),
    );
    expect(stdout.join('')).toMatch(/wrote bin\/demo-cli\.js, package\.json/);
  });

  it('prints a no-op line when the engine authors nothing (#299)', async () => {
    writeLauncherMock.mockReturnValue([]);
    const code = await run(argv('write-launcher', '--cwd', '/tree', '--path', 'packages/ts'));
    expect(code).toBe(0);
    expect(stdout.join('')).toMatch(/no-op/);
  });

  it('errors when --path is missing (#299)', async () => {
    const code = await run(argv('write-launcher', '--cwd', '/tree'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/--path/);
    expect(writeLauncherMock).not.toHaveBeenCalled();
  });
});

describe('cli: publish dispatch', () => {
  it('routes to the engine and reports an empty publish set', async () => {
    publishMock.mockResolvedValue({ ok: true, published: [] });
    const code = await run(argv('publish', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(publishMock).toHaveBeenCalledOnce();
    expect(stdout.join('')).toMatch(/published: \(nothing\)/);
  });
});

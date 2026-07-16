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

import { advanceFloatingMajor } from './advance-floating-major.js';
import { advanceV0 } from './advance-v0.js';
import { parseFlags, run } from './cli.js';
import { runChecks } from './check.js';
import { foldActionBundle } from './fold-action-bundle.js';
import { computePlanStatus } from './plan-status.js';
import { publish } from './publish.js';
import { reconcile } from './reconcile.js';
import { releaseGithub } from './release-github/index.js';
import { computeStatus } from './status.js';
import { verifyBundleCli } from './verify/bundle-cli/index.js';
import { verifyCrate } from './verify/crate/index.js';
import { verifyNpmTarball } from './verify/npm-tarball/index.js';
import { computeVerify } from './verify/posture.js';
import { verifyWheel } from './verify/wheel/index.js';
import { writeCrateVersionForBuild } from './write-crate-version.js';
import { writeLauncherFromConfig } from './write-launcher.js';
import { writeVersionForBuild } from './write-version.js';
import type { CheckFinding } from './check.js';
import type { MatrixRow } from './plan.js';
import type { PlanStatus } from './plan-status-types.js';
import type { StatusRow } from './status-types.js';

vi.mock('node:fs');
vi.mock('./advance-floating-major.js');
vi.mock('./advance-v0.js');
vi.mock('./check.js');
vi.mock('./fold-action-bundle.js');
vi.mock('./plan-status.js');
vi.mock('./publish.js');
vi.mock('./reconcile.js');
vi.mock('./release-github/index.js');
vi.mock('./status.js');
vi.mock('./verify/bundle-cli/index.js');
vi.mock('./verify/crate/index.js');
vi.mock('./verify/npm-tarball/index.js');
vi.mock('./verify/posture.js');
vi.mock('./verify/wheel/index.js');
vi.mock('./write-crate-version.js');
vi.mock('./write-launcher.js');
vi.mock('./write-version.js');

const runChecksMock = vi.mocked(runChecks);
const computePlanStatusMock = vi.mocked(computePlanStatus);
const publishMock = vi.mocked(publish);
const computeStatusMock = vi.mocked(computeStatus);
const reconcileMock = vi.mocked(reconcile);
const computeVerifyMock = vi.mocked(computeVerify);
const verifyNpmTarballMock = vi.mocked(verifyNpmTarball);
const verifyCrateMock = vi.mocked(verifyCrate);
const verifyWheelMock = vi.mocked(verifyWheel);
const verifyBundleCliMock = vi.mocked(verifyBundleCli);
const releaseGithubMock = vi.mocked(releaseGithub);
const advanceV0Mock = vi.mocked(advanceV0);
const advanceFloatingMajorMock = vi.mocked(advanceFloatingMajor);
const foldActionBundleMock = vi.mocked(foldActionBundle);
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
  reconcileMock.mockResolvedValue({ ok: true, dryRun: false, actions: [] });
  computeVerifyMock.mockResolvedValue([]);
  verifyNpmTarballMock.mockResolvedValue(0);
  verifyCrateMock.mockReturnValue(0);
  verifyWheelMock.mockReturnValue(0);
  verifyBundleCliMock.mockReturnValue(0);
  releaseGithubMock.mockReturnValue(0);
  advanceV0Mock.mockReturnValue(0);
  advanceFloatingMajorMock.mockReturnValue(0);
  foldActionBundleMock.mockReturnValue(0);
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

  it('stringifies a non-Error rejection in the error prefix', async () => {
    // The catch clause renders `String(err)` when the thrown value is not an
    // Error instance — a mocked collaborator rejecting with a bare string
    // exercises that fallback.
    computePlanStatusMock.mockRejectedValue('plain string boom');
    const code = await run(argv('plan', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/putitoutthere: plain string boom/);
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

  it('keeps the default cwd when --cwd is passed with no value', () => {
    // Trailing `--cwd` with nothing after it: `argv[++i]` is undefined and
    // the `?? out.cwd` fallback preserves the process cwd rather than
    // overwriting it with undefined.
    const flags = parseFlags(['--cwd']);
    expect(flags.cwd).toBe(process.cwd());
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

  it('parses the verify / write / fold flag family', () => {
    const flags = parseFlags([
      '--config', '/c/piot.toml',
      '--matrix', '[]',
      '--registry', 'https://reg',
      '--registry-root', '/root',
      '--target', 'sdist',
      '--subject', 'chore: bundle',
      '--stage-to', 'wheel/dir',
      '--bin', 'demo',
      '--per-triple',
    ]);
    expect(flags.config).toBe('/c/piot.toml');
    expect(flags.matrix).toBe('[]');
    expect(flags.registry).toBe('https://reg');
    expect(flags.registryRoot).toBe('/root');
    expect(flags.target).toBe('sdist');
    expect(flags.subject).toBe('chore: bundle');
    expect(flags.stageTo).toBe('wheel/dir');
    expect(flags.bin).toBe('demo');
    expect(flags.perTriple).toBe(true);
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

  it('renders multiple findings with per-package prefixes and --config (#319)', async () => {
    runChecksMock.mockReturnValue([
      { message: 'top-level problem' },
      { package: 'demo', message: 'package problem' },
    ]);
    const code = await run(argv('check', '--cwd', '/x', '--config', '/x/piot.toml'));
    expect(code).toBe(1);
    const err = stderr.join('');
    expect(err).toMatch(/check: 2 findings/);
    expect(err).toContain('demo: package problem');
    expect(err).toContain('top-level problem');
    expect(runChecksMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/x/piot.toml' }),
    );
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

  it('forwards --config to computeStatus', async () => {
    computeStatusMock.mockResolvedValue([]);
    const code = await run(argv('status', '--cwd', '/x', '--config', '/x/piot.toml'));
    expect(code).toBe(0);
    expect(computeStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/x/piot.toml' }),
    );
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

  it('prints SKIP / UNKNOWN verdict marks and skew warnings with --config', async () => {
    computePlanStatusMock.mockResolvedValue({
      matrix: [matrixRow('dep'), matrixRow('app')],
      verdicts: [
        { package: 'dep', kind: 'crates', version: '1.0.0', verdict: 'skip' },
        { package: 'app', kind: 'npm', version: '1.0.0', verdict: 'unknown' },
      ],
      skew: [{ dependent: 'app', dependency: 'dep' }],
    });
    const code = await run(argv('plan', '--cwd', '/x', '--config', '/x/piot.toml'));
    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('SKIP');
    expect(out).toContain('UNKNOWN');
    expect(out).toContain('version skew: app');
    expect(computePlanStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/x/piot.toml' }),
    );
  });
});

describe('cli: write-version dispatch', () => {
  it('routes to the engine with the resolved path and version', async () => {
    const code = await run(argv('write-version', '--path', '/pkg', '--version', '0.2.8'));
    expect(code).toBe(0);
    expect(writeVersionMock).toHaveBeenCalledWith('/pkg', '0.2.8');
    expect(stdout.join('')).toMatch(/write-version:/);
  });

  it('resolves a relative --path against --cwd (#276)', async () => {
    const code = await run(argv('write-version', '--cwd', '/root', '--path', 'pkg', '--version', '0.2.8'));
    expect(code).toBe(0);
    // The resolved target is OS-specific; assert the trailing segment
    // separator-agnostically.
    expect(writeVersionMock).toHaveBeenCalledWith(
      expect.stringMatching(/[/\\]pkg$/),
      '0.2.8',
    );
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

  it('forwards --config to the launcher engine (#299)', async () => {
    writeLauncherMock.mockReturnValue([]);
    const code = await run(argv('write-launcher', '--cwd', '/tree', '--path', 'packages/ts', '--config', '/tree/piot.toml'));
    expect(code).toBe(0);
    expect(writeLauncherMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/tree/piot.toml' }),
    );
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

  it('emits the publish result as JSON under --json', async () => {
    publishMock.mockResolvedValue({ ok: true, published: [] });
    const code = await run(argv('publish', '--cwd', '/x', '--json'));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join('').trim()) as { published: unknown[] };
    expect(parsed.published).toEqual([]);
  });

  it('lists each published package in the human-readable render', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      published: [
        { package: 'demo', version: '1.2.3', result: { status: 'published' }, tag: 'demo-v1.2.3' },
      ],
    });
    const code = await run(argv('publish', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('published: demo@1.2.3  status=published');
  });

  it('forwards --config to the publish engine', async () => {
    publishMock.mockResolvedValue({ ok: true, published: [] });
    const code = await run(argv('publish', '--cwd', '/x', '--config', '/x/piot.toml'));
    expect(code).toBe(0);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/x/piot.toml' }),
    );
  });
});

describe('cli: reconcile dispatch', () => {
  it('emits the reconcile result as JSON under --json and forwards --config', async () => {
    reconcileMock.mockResolvedValue({ ok: true, dryRun: false, actions: [] });
    const code = await run(argv('reconcile', '--cwd', '/x', '--json', '--config', '/x/piot.toml'));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join('').trim()) as { actions: unknown[] };
    expect(parsed.actions).toEqual([]);
    expect(reconcileMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/x/piot.toml', dryRun: false }),
    );
  });

  it('prints created tags in the human-readable render', async () => {
    reconcileMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      actions: [
        {
          package: 'demo',
          kind: 'crates',
          version: '0.1.0',
          tag: 'demo-v0.1.0',
          commit: 'abcdef1234567',
          source: 'head',
          created: true,
        },
      ],
    });
    const code = await run(argv('reconcile', '--cwd', '/x'));
    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('demo: 0.1.0 live, no tag → created demo-v0.1.0 at abcdef1 (head)');
    expect(out).toMatch(/reconcile: created 1 tag/);
  });

  it('uses "would create" verbs under --dry-run', async () => {
    reconcileMock.mockResolvedValue({
      ok: true,
      dryRun: true,
      actions: [
        {
          package: 'demo',
          kind: 'crates',
          version: '0.1.0',
          tag: 'demo-v0.1.0',
          commit: 'abcdef1234567',
          source: 'sibling',
          created: false,
        },
      ],
    });
    const code = await run(argv('reconcile', '--cwd', '/x', '--dry-run'));
    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('would create demo-v0.1.0');
    expect(out).toMatch(/reconcile: would create 1 tag/);
    expect(reconcileMock).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });
});

describe('cli: verify dispatch', () => {
  it('renders posture rows and exits 0 without --check, forwarding --config', async () => {
    computeVerifyMock.mockResolvedValue([
      { package: 'demo', kind: 'npm', version: '1.0.0', posture: 'oidc' },
    ]);
    const code = await run(argv('verify', '--cwd', '/x', '--config', '/x/piot.toml'));
    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('demo');
    expect(out).toContain('oidc');
    expect(computeVerifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/x/piot.toml' }),
    );
  });

  it('defaults to the posture subcommand on a bare verify invocation', async () => {
    computeVerifyMock.mockResolvedValue([]);
    const code = await run(argv('verify'));
    expect(code).toBe(0);
    expect(computeVerifyMock).toHaveBeenCalledOnce();
  });

  it('emits posture rows as JSON under --json', async () => {
    computeVerifyMock.mockResolvedValue([
      { package: 'demo', kind: 'npm', version: null, posture: 'unpublished' },
    ]);
    const code = await run(argv('verify', '--cwd', '/x', '--json'));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join('').trim()) as Array<{ posture: string }>;
    expect(parsed[0]!.posture).toBe('unpublished');
  });

  it('exits 1 under --check when any package is token-dependent', async () => {
    computeVerifyMock.mockResolvedValue([
      { package: 'demo', kind: 'npm', version: '1.0.0', posture: 'token' },
    ]);
    const code = await run(argv('verify', '--check', '--cwd', '/x'));
    expect(code).toBe(1);
  });

  it('exits 0 under --check when no package is token-dependent', async () => {
    computeVerifyMock.mockResolvedValue([
      { package: 'demo', kind: 'npm', version: '1.0.0', posture: 'oidc' },
    ]);
    const code = await run(argv('verify', '--check', '--cwd', '/x'));
    expect(code).toBe(0);
  });

  it('routes verify npm-tarball to the verifier', async () => {
    verifyNpmTarballMock.mockResolvedValue(0);
    const code = await run(
      argv('verify', 'npm-tarball', '--cwd', '/x', '--matrix', '[]', '--registry', 'https://reg', '--per-triple'),
    );
    expect(code).toBe(0);
    expect(verifyNpmTarballMock).toHaveBeenCalledWith(
      expect.objectContaining({ matrix: '[]', registry: 'https://reg', perTriple: true }),
    );
  });

  it('errors when verify npm-tarball is missing --matrix', async () => {
    const code = await run(argv('verify', 'npm-tarball', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify npm-tarball requires --matrix/);
  });

  it('routes verify crate to the verifier', async () => {
    verifyCrateMock.mockReturnValue(0);
    const code = await run(argv('verify', 'crate', '--cwd', '/x', '--matrix', '[]', '--registry-root', '/root'));
    expect(code).toBe(0);
    expect(verifyCrateMock).toHaveBeenCalledWith({ matrix: '[]', registryRoot: '/root' });
  });

  it('errors when verify crate is missing --matrix', async () => {
    const code = await run(argv('verify', 'crate', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify crate requires --matrix/);
  });

  it('errors when verify crate is missing --registry-root', async () => {
    const code = await run(argv('verify', 'crate', '--cwd', '/x', '--matrix', '[]'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify crate requires --registry-root/);
  });

  it('routes verify wheel to the verifier', async () => {
    verifyWheelMock.mockReturnValue(0);
    const code = await run(
      argv('verify', 'wheel', '--cwd', '/x', '--path', '/pkg', '--version', '1.0.0', '--target', 'sdist'),
    );
    expect(code).toBe(0);
    expect(verifyWheelMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/pkg', version: '1.0.0', target: 'sdist' }),
    );
  });

  it('errors when verify wheel is missing --path', async () => {
    const code = await run(argv('verify', 'wheel', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify wheel requires --path/);
  });

  it('errors when verify wheel is missing --version', async () => {
    const code = await run(argv('verify', 'wheel', '--cwd', '/x', '--path', '/pkg'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify wheel requires --version/);
  });

  it('errors when verify wheel is missing --target', async () => {
    const code = await run(argv('verify', 'wheel', '--cwd', '/x', '--path', '/pkg', '--version', '1.0.0'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify wheel requires --target/);
  });

  it('routes verify bundle-cli to the verifier', async () => {
    verifyBundleCliMock.mockReturnValue(0);
    const code = await run(
      argv('verify', 'bundle-cli', '--cwd', '/x', '--path', '/pkg', '--stage-to', 'dir', '--bin', 'demo', '--target', 'x86_64'),
    );
    expect(code).toBe(0);
    expect(verifyBundleCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/pkg', stageTo: 'dir', bin: 'demo', target: 'x86_64' }),
    );
  });

  it('errors when verify bundle-cli is missing --path', async () => {
    const code = await run(argv('verify', 'bundle-cli', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify bundle-cli requires --path/);
  });

  it('errors when verify bundle-cli is missing --stage-to', async () => {
    const code = await run(argv('verify', 'bundle-cli', '--cwd', '/x', '--path', '/pkg'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify bundle-cli requires --stage-to/);
  });

  it('errors when verify bundle-cli is missing --bin', async () => {
    const code = await run(argv('verify', 'bundle-cli', '--cwd', '/x', '--path', '/pkg', '--stage-to', 'dir'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify bundle-cli requires --bin/);
  });

  it('errors when verify bundle-cli is missing --target', async () => {
    const code = await run(argv('verify', 'bundle-cli', '--cwd', '/x', '--path', '/pkg', '--stage-to', 'dir', '--bin', 'demo'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/verify bundle-cli requires --target/);
  });

  it('errors on an unknown verify subcommand', async () => {
    const code = await run(argv('verify', 'bogus', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/unknown verify subcommand: bogus/);
  });
});

describe('cli: release-github / advance / fold dispatch', () => {
  it('routes release-github to the engine', async () => {
    releaseGithubMock.mockReturnValue(0);
    const code = await run(argv('release-github', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(releaseGithubMock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('routes advance-v0 to the engine', async () => {
    advanceV0Mock.mockReturnValue(0);
    const code = await run(argv('advance-v0', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(advanceV0Mock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('routes advance-floating-major to the engine', async () => {
    advanceFloatingMajorMock.mockReturnValue(0);
    const code = await run(argv('advance-floating-major', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(advanceFloatingMajorMock).toHaveBeenCalledWith({ cwd: '/x' });
  });

  it('routes fold-bundle to the engine with the subject', async () => {
    foldActionBundleMock.mockReturnValue(0);
    const code = await run(argv('fold-bundle', '--cwd', '/x', '--subject', 'chore(release): bundle'));
    expect(code).toBe(0);
    expect(foldActionBundleMock).toHaveBeenCalledWith({ cwd: '/x', subject: 'chore(release): bundle' });
  });

  it('errors when fold-bundle is missing --subject', async () => {
    const code = await run(argv('fold-bundle', '--cwd', '/x'));
    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/fold-bundle: --subject/);
    expect(foldActionBundleMock).not.toHaveBeenCalled();
  });

  // #461: surface what actually shipped as $GITHUB_OUTPUT so the reusable
  // workflow can propagate `released` / `released_packages` outputs a
  // consumer gates a post-release job on. The cast keeps this test stable
  // across the red (no `tag` on the output type yet) and green commits.
  it('appends released=true and released_packages= to $GITHUB_OUTPUT when a package newly ships (#461)', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      published: [
        { package: 'lib-js', version: '1.2.3', result: { status: 'published' }, tag: 'lib-js-v1.2.3' },
      ],
    } as unknown as Awaited<ReturnType<typeof publish>>);
    process.env.GITHUB_OUTPUT = '/gha/output.txt';
    const code = await run(argv('publish', '--cwd', '/x'));
    expect(code).toBe(0);
    const written = appendFileSyncMock.mock.calls
      .map((c) => String(c[1]))
      .join('');
    expect(written).toMatch(/(^|\n)released=true\n/);
    const line = written.split('\n').find((l) => l.startsWith('released_packages='));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!.slice('released_packages='.length)) as Array<{
      name: string;
      version: string;
      tag: string;
    }>;
    expect(parsed).toEqual([{ name: 'lib-js', version: '1.2.3', tag: 'lib-js-v1.2.3' }]);
    expect(appendFileSyncMock.mock.calls[0]![0]).toBe('/gha/output.txt');
  });

  it('appends released=false with an empty released_packages= when nothing newly ships (#461)', async () => {
    publishMock.mockResolvedValue({ ok: true, published: [] });
    process.env.GITHUB_OUTPUT = '/gha/output.txt';
    const code = await run(argv('publish', '--cwd', '/x'));
    expect(code).toBe(0);
    const written = appendFileSyncMock.mock.calls
      .map((c) => String(c[1]))
      .join('');
    expect(written).toMatch(/(^|\n)released=false\n/);
    expect(written).toMatch(/(^|\n)released_packages=\[\]\n/);
  });

  it('an already-published package does not count as newly released (#461)', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      published: [
        { package: 'lib-js', version: '1.2.3', result: { status: 'already-published' }, tag: 'lib-js-v1.2.3' },
      ],
    } as unknown as Awaited<ReturnType<typeof publish>>);
    process.env.GITHUB_OUTPUT = '/gha/output.txt';
    const code = await run(argv('publish', '--cwd', '/x'));
    expect(code).toBe(0);
    const written = appendFileSyncMock.mock.calls
      .map((c) => String(c[1]))
      .join('');
    expect(written).toMatch(/(^|\n)released=false\n/);
    expect(written).toMatch(/(^|\n)released_packages=\[\]\n/);
  });

  it('does NOT touch $GITHUB_OUTPUT when it is unset (#461)', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      published: [
        { package: 'lib-js', version: '1.2.3', result: { status: 'published' }, tag: 'lib-js-v1.2.3' },
      ],
    } as unknown as Awaited<ReturnType<typeof publish>>);
    delete process.env.GITHUB_OUTPUT;
    const code = await run(argv('publish', '--cwd', '/x'));
    expect(code).toBe(0);
    expect(appendFileSyncMock).not.toHaveBeenCalled();
  });
});

/**
 * The `pypi-tag` job must tag what the upload shipped, and must never
 * report "nothing to do" for a registry it could not read — against the
 * **real** surfaces and the real pypi.org (#694). E2e twin of
 * `tests/integration/pypi-tag-race.integration.test.ts`.
 *
 * `agent-transcript-viewer 0.0.0` reached PyPI with no tag, twice, from a
 * `pypi-tag` job that exited 0 reporting `actions: []`.
 *
 * Two things only an unmocked run can establish:
 *
 * 1. **The surface `pypi-tag.yml` invokes is the ncc-bundled action**, not
 *    `dist/cli-bin.js` — `uses: thekevinscott/putitoutthere@v0`, driven
 *    entirely by `INPUT_*`. A green CLI e2e says nothing about whether the
 *    action forwards an expectation at all, and today `action.yml` has no
 *    `expect` input to forward. These tests run `dist-action/index.js` as a
 *    real subprocess with exactly the env GitHub Actions sets.
 * 2. **An unreadable PyPI is a real HTTP status, not a mock.** The skip
 *    that loses a tag has to be observable against a registry that really
 *    does refuse to answer — see `UNREADABLE_PROJECT` below.
 *
 * Both tagging scenarios pin to `0.0.1` of the live fixture project: a
 * permanently published version that is NOT the project's latest, so the
 * mutable `info.version` pointer never names it and a `fixture-py-v0.0.1`
 * tag can only have come from the expectation path. Nothing here reads the
 * latest pointer for an assertion, so nothing moves when the fixture
 * publishes again mid-run.
 *
 * No publish, no auth, no build: reconcile only reads the registry and
 * writes a git tag. The repo gets a real, local bare-repo `origin` (#717
 * requires the push to actually succeed), so the tag landing on that
 * origin is the observable contract.
 *
 * Red before #694: the action has no `expect` input, so it discovers from
 * the latest pointer and cuts a tag for whatever that names (or nothing);
 * and `reconcile --json` reports `actions: []` with no `skipped` and no
 * annotation for a registry it never reached.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` and `dist-action/` first).
 * Issue #694.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PKG_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const CLI = join(PKG_ROOT, 'dist', 'cli-bin.js');
// ncc writes the action bundle to the workspace root, not the package.
const ACTION = join(PKG_ROOT, '..', '..', 'dist-action', 'index.js');

const PYPI_PROJECT = 'piot-fixture-zzz-python-sdist';
/** Published, immutable, and never the project's latest. */
const LIVE_VERSION = '0.0.1';
/** Never published, and never will be — a real 404 from pypi.org. */
const ABSENT_VERSION = '999.999.999';

let repo: string;
let remote: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

/**
 * Tag names as a list, never as one blob. The fixture's live versions are
 * timestamp-suffixed (`0.0.1788209490`), so a substring assertion for
 * `fixture-py-v0.0.1` matches the tag for a completely different release
 * and would pass with no expectation path at all.
 */
function tags(): string[] {
  return git(['tag', '-l']).split('\n').filter(Boolean);
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function captured(err: unknown): Run {
  const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
  return {
    code: e.status ?? 1,
    stdout: e.stdout?.toString() ?? '',
    stderr: e.stderr?.toString() ?? '',
  };
}

/** Shell out to the built CLI; capture exit + both streams either way. */
function runCli(args: string[]): Run {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return captured(err);
  }
}

/**
 * Run the bundled action with the `INPUT_*` env GitHub Actions would set
 * — the surface `pypi-tag.yml` actually calls.
 */
function runAction(inputs: Record<string, string>): Run {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const [k, v] of Object.entries(inputs)) {
    env[`INPUT_${k.toUpperCase()}`] = v;
  }
  try {
    const stdout = execFileSync('node', [ACTION], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return captured(err);
  }
}

/**
 * reconcile reads only config + tags + the registry — no manifest, no
 * preflight — so a bare config naming a PyPI project is enough.
 */
function writeConfig(pypiName: string): void {
  writeFileSync(
    join(repo, 'putitoutthere.toml'),
    `[putitoutthere]
version = 1

[[package]]
name  = "fixture-py"
kind  = "pypi"
pypi  = "${pypiName}"
path  = "packages/py"
globs = ["packages/py/**"]
`,
    'utf8',
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-pypi-tag-race-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  // ensureTag (#717) now requires a real push to succeed before it
  // considers a release tagged; give it a real, local `origin` to push to.
  remote = mkdtempSync(join(tmpdir(), 'piot-pypi-tag-race-e2e-remote-'));
  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote });
  git(['remote', 'add', 'origin', remote]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

describe('pypi-tag tags the upload it was told about (#694)', () => {
  it("cuts the tag from the release job's delegated_packages, through the action", () => {
    // The wiring verbatim: `pypi-tag.yml` forwards the release job's
    // `delegated_packages` output — `[{"name","version","tag"}, …]` — to
    // the action, unreshaped. 0.0.1 is live and untagged here, and PyPI's
    // `info.version` names a far newer release, so discovery can never
    // reach it. A `fixture-py-v0.0.1` tag proves the expectation
    // travelled all the way through the bundle.
    writeConfig(PYPI_PROJECT);

    const { code, stdout, stderr } = runAction({
      command: 'reconcile',
      working_directory: repo,
      expect: `[{"name":"fixture-py","version":"${LIVE_VERSION}","tag":"fixture-py-v${LIVE_VERSION}"}]`,
    });
    const output = `${stdout}\n${stderr}`;

    expect(code, output).toBe(0);
    // Exact, not `toContain`: before the input exists the action
    // discovers the latest pointer instead and cuts *that* tag, which a
    // containment assertion on a different tag would not notice.
    expect(tags(), output).toEqual([`fixture-py-v${LIVE_VERSION}`]);
  });

  it('fails the job when pypi.org does not confirm the reported upload', () => {
    // The upload step uploaded nothing. A real 404 from the immutable
    // per-version endpoint. Exiting 0 here — and worse, tagging whatever
    // the latest pointer happens to name — records success for a release
    // that did not happen.
    writeConfig(PYPI_PROJECT);

    const { code, stdout, stderr } = runAction({
      command: 'reconcile',
      working_directory: repo,
      expect: `fixture-py@${ABSENT_VERSION}`,
    });
    const output = `${stdout}\n${stderr}`;

    expect(code, output).not.toBe(0);
    expect(output).toContain(ABSENT_VERSION);
    expect(tags(), output).toEqual([]);
  });
});

describe('reconcile does not report an unreadable registry as nothing to do (#694)', () => {
  /**
   * A project name pypi.org refuses to answer at all. 9000 characters
   * overruns the request-line limit, so the CDN replies **414** — a real,
   * deterministic non-404 from the real host, which is what the handler
   * turns into an unreachable registry. (A 5xx would do, but cannot be
   * induced on demand; a 404 is an *answer* — "never published" — and
   * deliberately is not a skip worth warning about.)
   */
  const UNREADABLE_PROJECT = 'a'.repeat(9000);

  it('names the package it could not decide, in --json and as an annotation', () => {
    writeConfig(UNREADABLE_PROJECT);

    const { code, stdout, stderr } = runCli(['reconcile', '--json', '--cwd', repo]);
    const output = `${stdout}\n${stderr}`;

    expect(code, output).toBe(0);
    // Annotations share stdout with the JSON document, so stdout as a
    // whole is not parseable — pick the JSON out by line.
    const lines = stdout.split('\n');
    const json = lines.find((l) => l.startsWith('{'));
    expect(json, output).toBeDefined();
    const result = JSON.parse(json ?? '{}') as Record<string, unknown>;

    expect(result.actions, output).toEqual([]);
    // `actions: []` and nothing else is the silent-success hole: the
    // reason a tag may be missing has to travel with the result.
    expect(result.skipped, output).toEqual([
      { package: 'fixture-py', kind: 'pypi', reason: 'registry-unreachable' },
    ]);
    const warnings = lines.filter((l) => l.startsWith('::warning'));
    expect(warnings, output).toHaveLength(1);
    expect(warnings[0], output).toContain('fixture-py');
  });

  it('stays silent about a package that simply was never published', () => {
    // The other reason a row is skipped, and the steady state of every
    // package a repo has not shipped yet. Warning on it would make the
    // signal worthless, so pypi.org's genuine 404 must stay quiet.
    writeConfig('piot-fixture-zzz-definitely-not-a-real-project');

    const { code, stdout, stderr } = runCli(['reconcile', '--json', '--cwd', repo]);
    const output = `${stdout}\n${stderr}`;

    expect(code, output).toBe(0);
    const json = stdout.split('\n').find((l) => l.startsWith('{'));
    const result = JSON.parse(json ?? '{}') as Record<string, unknown>;
    expect(result.skipped, output).toEqual([]);
    expect(stdout, output).not.toContain('::warning');
  });
});

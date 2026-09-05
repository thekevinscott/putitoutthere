/**
 * `piot reconcile --expect` against the real CLI + real pypi.org — the
 * e2e twin of `tests/integration/reconcile-expect.integration.test.ts`.
 *
 * Where the integration test imports the engine in-process and mocks the
 * registry HTTP (msw), this one **shells out to the built CLI**
 * (`node dist/cli-bin.js reconcile --expect …`) and reads PyPI for real.
 * That is the point: the bug in #666 is a property of pypi.org's actual
 * cache behaviour, and only an unmocked read can show that the endpoint
 * the fix depends on behaves as assumed.
 *
 * Both scenarios pin themselves to `0.0.1` of the live fixture project —
 * a permanently published version that is NOT the project's latest. So
 * the mutable, CDN-cached `info.version` pointer never names it, and a
 * `fixture-py-v0.0.1` tag can only have come from the expectation path.
 * Nothing here reads the latest pointer, so nothing here moves when the
 * fixture publishes again mid-run.
 *
 * No publish, no auth, no build: reconcile only reads the registry and
 * writes a git tag. The throwaway repo has no `origin`, so the tag push
 * is warned-not-fatal — the local tag is the observable contract.
 *
 * Red before #666: `--expect` is an unrecognised flag, so reconcile
 * discovers from the latest pointer, never tags 0.0.1, and reports
 * success for a version it was told to confirm and did not.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issue #666.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const PYPI_PROJECT = 'piot-fixture-zzz-python-sdist';
/** Published, immutable, and never the project's latest. */
const LIVE_VERSION = '0.0.1';
/** Never published, and never will be — a real 404 from pypi.org. */
const ABSENT_VERSION = '999.999.999';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/**
 * Tag names as a list, never as one blob. The fixture's live versions are
 * timestamp-suffixed (`0.0.1788209490`), so a substring assertion for
 * `fixture-py-v0.0.1` matches the tag for a completely different release
 * and passes without the expectation path existing at all.
 */
function tags(): string[] {
  return git(['tag', '-l']).split('\n').filter(Boolean);
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-reconcile-expect-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  // reconcile reads only config + tags + the registry — no manifest, no
  // preflight — so a bare config naming the live project is enough.
  writeFileSync(
    join(repo, 'putitoutthere.toml'),
    `[putitoutthere]
version = 1

[[package]]
name  = "fixture-py"
kind  = "pypi"
pypi  = "${PYPI_PROJECT}"
path  = "packages/py"
globs = ["packages/py/**"]
`,
    'utf8',
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('piot reconcile --expect against pypi.org (#666)', () => {
  it('tags a version the live latest pointer does not name', () => {
    // 0.0.1 is live on PyPI and has no tag here, but PyPI's
    // `info.version` names a much newer release — exactly the shape a
    // stale edge produces post-upload, without having to race a CDN.
    // Discovery can never reach 0.0.1; the expectation must.
    const { code, stdout, stderr } = runCli([
      'reconcile',
      '--expect',
      `fixture-py@${LIVE_VERSION}`,
      '--cwd',
      repo,
    ]);
    const output = `${stdout}\n${stderr}`;

    expect(code, output).toBe(0);
    expect(tags(), output).toContain(`fixture-py-v${LIVE_VERSION}`);
  });

  it('exits non-zero when pypi.org does not confirm the expected version', () => {
    // A real 404 from the immutable per-version endpoint. Reporting
    // success here is what #666 is about: the caller said it uploaded
    // this, PyPI says otherwise, and the tag must not be invented.
    const { code, stdout, stderr } = runCli([
      'reconcile',
      '--expect',
      `fixture-py@${ABSENT_VERSION}`,
      '--cwd',
      repo,
    ]);
    const output = `${stdout}\n${stderr}`;

    expect(code, output).not.toBe(0);
    expect(output).toContain(ABSENT_VERSION);
    expect(tags(), output).not.toContain(`fixture-py-v${ABSENT_VERSION}`);
  });
});

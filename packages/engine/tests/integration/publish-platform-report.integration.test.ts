/**
 * `publish` report → per-platform publish summary (#625).
 *
 * Drives the real CLI `run(['publish', '--json', ...])` against a real
 * git repo, the default `handlerFor` (the actual npm handler
 * dispatches), and a fake npm registry implemented by mocking the Node
 * built-in `execFile` underneath the first-party process seam. Every
 * piece of putitoutthere's own code runs verbatim: config loader, plan,
 * preflight, completeness, `publishPlatforms`, the main-package publish,
 * tag formatting, and the JSON report the CLI prints.
 *
 * The contract under test: a `napi` / `bundled-cli` release publishes a
 * platform package per target *plus* the umbrella package, and the run
 * report has to name all of them. `publishPlatforms` already returns
 * `{ published, skipped }`; before #625 the npm handler discarded it, so
 * a six-package release reported exactly one line and an operator
 * reading the log could not tell a complete multi-package publish from a
 * partial one that shipped the umbrella and stopped.
 *
 * The `skipped` half is asserted with equal weight: on a re-run after a
 * partial failure, "these two were already on the registry, so I skipped
 * them" is the reassurance the operator needs, and it was invisible too.
 *
 * The e2e twin — the same two scenarios driven through the built CLI as a
 * real subprocess with the real `npm` CLI publishing to a real (local)
 * registry over HTTP — is `tests/e2e/publish-platform-report.e2e.test.ts`.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Mock only the Node built-in `execFile` underneath the first-party
// process seam (`execCapture`); the seam itself runs for real. Intercept
// `npm` (canned registry responses) and delegate everything else — `git`
// in particular — to the real `execFile` so plan()'s git reads and the
// post-publish tag write work against the real fixture repo.
const realExecFile = (await vi.importActual<typeof ChildProcess>('node:child_process')).execFile;
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

/** A minimal execFile-child stand-in that emits `close` with `code`. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

const TARGETS = ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'] as const;
const PLATFORM_NAMES = TARGETS.map((t) => `demo-cli-${t}`);

let repo: string;

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

const TOML = `
[putitoutthere]
version = 1

[[package]]
name    = "demo-cli"
kind    = "npm"
path    = "packages/js"
globs   = ["packages/js/**"]
build   = "napi"
targets = [${TARGETS.map((t) => `"${t}"`).join(', ')}]
`;

/**
 * Wire the fake npm registry. `alreadyPublished` decides which package
 * names `npm view` reports as live — keyed by NAME, not name@version, so
 * the scenario doesn't have to predict the version the planner computes.
 */
function wireNpm(alreadyPublished: readonly string[]): void {
  const live = new Set(alreadyPublished);
  execMock.mockImplementation(((
    cmd: string,
    args: readonly string[],
    opts: unknown,
    cb: (e: Error | null, out: string, err: string) => void,
  ) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {
        // `npm view <name>@<version> version`; scoped names carry a
        // leading `@`, so split off the LAST `@` to get the name.
        const spec = String(a[1]);
        const at = spec.lastIndexOf('@');
        const name = at > 0 ? spec.slice(0, at) : spec;
        if (live.has(name)) {
          cb(null, '9.9.9\n', '');
          return fakeChild(0);
        }
        cb(Object.assign(new Error('E404'), { code: 1 }), '', '404 not found');
        return fakeChild(1);
      }
      if (a[0] === 'publish') {
        cb(null, '', '');
        return fakeChild(0);
      }
    }
    return (realExecFile as unknown as (...a: unknown[]) => ChildProcess.ChildProcess)(cmd, args, opts, cb);
  }) as unknown as typeof execFile);
}

/** Run the CLI and parse the `--json` report it writes to stdout. */
async function publishJson(): Promise<{
  ok: boolean;
  published: Array<{
    package: string;
    version: string;
    result: {
      status: string;
      url?: string;
      platforms?: { published: string[]; skipped: string[] };
    };
    tag: string;
  }>;
}> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((c: string | Uint8Array) => {
      chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);
  let code: number;
  try {
    code = await run(['node', 'putitoutthere', 'publish', '--json', '--cwd', repo]);
  } finally {
    spy.mockRestore();
  }
  const stdout = chunks.join('');
  expect(code, `publish exited non-zero. stdout:\n${stdout}`).toBe(0);
  return JSON.parse(stdout.trim()) as Awaited<ReturnType<typeof publishJson>>;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-platform-report-int-'));

  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', TOML);
  writeRepoFile('packages/js/index.js', 'module.exports = {};\n');
  writeRepoFile(
    'packages/js/package.json',
    JSON.stringify(
      {
        name: 'demo-cli',
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
      },
      null,
      2,
    ) + '\n',
  );

  // Staged build output the publish path reads: one artifact directory
  // per target holding that target's `.node`, plus the `main` row's
  // package.json. Matches the `artifacts/<artifact_name>/` layout the
  // planner emits and `checkCompleteness` enforces.
  for (const target of TARGETS) {
    writeRepoFile(`artifacts/demo-cli-${target}/demo-cli.${target}.node`, `native-${target}`);
  }
  writeRepoFile('artifacts/demo-cli-main/package.json', '{"name":"demo-cli"}\n');

  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);

  process.env.NODE_AUTH_TOKEN = 'tok';
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
  execMock.mockReset();
});

describe('publish report: per-platform publish summary (#625)', () => {
  it('names every platform package it published alongside the umbrella package', async () => {
    // Nothing is on the registry: the umbrella package and both platform
    // packages all publish this run.
    wireNpm([]);

    const report = await publishJson();

    expect(report.published).toHaveLength(1);
    const [entry] = report.published;
    expect(entry!.package).toBe('demo-cli');
    expect(entry!.result.status).toBe('published');

    // The six-packages-reported-as-one bug: the umbrella entry has to
    // carry the platform packages that shipped with it.
    expect(entry!.result.platforms).toBeDefined();
    expect(entry!.result.platforms!.published).toEqual(PLATFORM_NAMES);
    expect(entry!.result.platforms!.skipped).toEqual([]);
  });

  it('names every platform package it skipped as already published', async () => {
    // A re-run after a partial failure: both platform packages already
    // reached the registry, only the umbrella package is missing. The
    // report has to say so — "these were already published, so I skipped
    // them" is the operator's confirmation that nothing was lost.
    wireNpm(PLATFORM_NAMES);

    const report = await publishJson();

    const [entry] = report.published;
    expect(entry!.result.status).toBe('published');
    expect(entry!.result.platforms).toBeDefined();
    expect(entry!.result.platforms!.skipped).toEqual(PLATFORM_NAMES);
    expect(entry!.result.platforms!.published).toEqual([]);
  });

  it('omits the platform summary for a vanilla npm package with no platform family', async () => {
    // A `build`-less package publishes no platform packages, so there is
    // no summary to report — an empty `{published: [], skipped: []}`
    // would read as "a platform family that shipped nothing".
    writeRepoFile(
      'putitoutthere.toml',
      `
[putitoutthere]
version = 1

[[package]]
name  = "demo-cli"
kind  = "npm"
path  = "packages/js"
globs = ["packages/js/**"]
`,
    );
    gitInRepo(['add', '-A']);
    gitInRepo(['commit', '-m', 'feat: vanilla\n\nrelease: patch']);
    wireNpm([]);

    const report = await publishJson();

    expect(report.published[0]!.result.status).toBe('published');
    expect(report.published[0]!.result.platforms).toBeUndefined();
  });
});

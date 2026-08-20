/**
 * Delegated PyPI publishes must not be tagged by the publish job (#623).
 *
 * The bug: the pypi handler does not upload — PyPI Trusted Publishers
 * cannot validate an OIDC token minted inside a cross-repo reusable
 * workflow (warehouse#11096), so the upload is delegated to a caller-side
 * `pypi-publish` job. The handler nevertheless reported `published`, so
 * `publish()` cut and pushed the package's git tag the moment it
 * *delegated*. When anything later in the run failed — a different
 * registry, a different package — the caller-side job (`needs: release`)
 * never ran, and the repo was left with `<pkg>-py-v<version>` pointing at
 * a distribution nobody ever uploaded. A tag is the record of what
 * shipped; that one recorded a lie, and only a manual tag deletion could
 * undo it.
 *
 * The contract, at two levels:
 *  1. A delegated package is reported as `delegated`, not `published`,
 *     and no tag is cut for it in the publish job.
 *  2. The delegation is still *announced* — `$GITHUB_OUTPUT` carries
 *     `delegated` / `delegated_packages` — and it survives a later
 *     handler failure, so the caller-side upload job can gate on "PyPI's
 *     own path succeeded" rather than on whole-job success.
 *
 * Tier: the deterministic CI red gate. Real config loader, real plan,
 * real preflight, real handler dispatch, real git; only the registry
 * boundary is mocked (msw for PyPI's HTTP read, the `execFile` beneath
 * the process seam for the npm CLI). The e2e twin
 * (`tests/e2e/pypi-delegated-tag.e2e.test.ts`) shells out to the built
 * CLI against the live PyPI.
 *
 * Red before the fix: the publish path tags the delegated package, and
 * `$GITHUB_OUTPUT` has no `delegated*` keys at all.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

/* --------------------------- registry mocks --------------------------- */

// The pypi handler's `isPublished` reads PyPI over `fetch`; 404 => the
// planned version is not live, so publish takes the delegation path.
const server = setupServer(
  http.get('https://pypi.org/pypi/:name/:version/json', () =>
    new HttpResponse('{"message":"Not Found"}', { status: 404 }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

// Dual-mock window: the npm handler and plan()'s git reads both flow
// through the first-party process seam (`execCapture`). Mock only the
// Node built-in underneath it and delegate `git` to the real thing, so
// the tag assertions run against a real repo.
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

/**
 * `npm view` 404s (nothing published yet) and `npm publish` resolves
 * with `publishExit` — 0 for the happy path, non-zero to model the
 * unrelated-registry failure that used to strand the PyPI tag.
 */
function mockNpm(publishExit: number): void {
  execMock.mockImplementation(((
    cmd: string,
    args: readonly string[],
    opts: unknown,
    cb: (e: Error | null, out: string, err: string) => void,
  ) => {
    if (cmd === 'npm') {
      const a = args as string[];
      if (a[0] === 'view') {
        cb(Object.assign(new Error('E404'), { code: 1 }), '', '404 not found');
        return fakeChild(1);
      }
      if (a[0] === 'publish') {
        if (publishExit === 0) {
          cb(null, '', '');
          return fakeChild(0);
        }
        cb(Object.assign(new Error('E404'), { code: publishExit }), '', 'npm error code E404\nnpm error 404 Scope not found');
        return fakeChild(publishExit);
      }
    }
    return (realExecFile as unknown as (...a: unknown[]) => ChildProcess.ChildProcess)(cmd, args, opts, cb);
  }) as unknown as typeof execFile);
}

/* ------------------------------- fixture ------------------------------- */

let repo: string;
let ghOutput: string;
const stdout: string[] = [];

function gitInRepo(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

const PY_ONLY = `
[putitoutthere]
version = 1

[[package]]
name  = "lib-py"
kind  = "pypi"
build = "setuptools"
path  = "packages/py"
globs = ["packages/py/**"]
`;

const PY_AND_JS = `${PY_ONLY}
[[package]]
name  = "lib-js"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`;

const PYPROJECT = `[project]
name = "lib-py"
dynamic = ["version"]
requires-python = ">=3.12"

[build-system]
requires = ["setuptools", "setuptools-scm"]
build-backend = "setuptools.build_meta"

[tool.setuptools_scm]
`;

/**
 * Stage the one artifact a setuptools pypi package plans (sdist-only) so
 * the completeness check passes. Its exact version doesn't matter — the
 * check asserts a `.tar.gz` is present, not which one.
 */
function stageSdistArtifact(): void {
  writeRepoFile('artifacts/lib-py-sdist/lib_py-0.0.0.tar.gz', 'sdist');
}

function seedRepo(config: string): void {
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);

  writeRepoFile('putitoutthere.toml', config);
  writeRepoFile('packages/py/pyproject.toml', PYPROJECT);
  writeRepoFile('packages/py/src/lib_py/__init__.py', '');
  writeRepoFile('packages/ts/index.ts', 'x');
  writeRepoFile(
    'packages/ts/package.json',
    JSON.stringify({
      name: 'lib-js',
      version: '0.0.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }),
  );
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-m', 'feat: initial\n\nrelease: patch']);
  stageSdistArtifact();
}

/** Every `key=value` line the CLI appended to `$GITHUB_OUTPUT`. */
function ghOutputValue(key: string): string | undefined {
  const line = readFileSync(ghOutput, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-pypi-delegated-int-'));
  ghOutput = join(repo, 'gha-output.txt');
  writeFileSync(ghOutput, '', 'utf8');
  stdout.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    stdout.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  process.env.NODE_AUTH_TOKEN = 'tok';
  process.env.PYPI_API_TOKEN = 'tok';
  process.env.GITHUB_OUTPUT = ghOutput;
  // Keep the repo-visibility / URL-match pre-flights off the wire: both
  // no-op when GITHUB_REPOSITORY is unset.
  delete process.env.GITHUB_REPOSITORY;
});

afterEach(() => {
  vi.restoreAllMocks();
  execMock.mockReset();
  server.resetHandlers();
  rmSync(repo, { recursive: true, force: true });
  delete process.env.NODE_AUTH_TOKEN;
  delete process.env.PYPI_API_TOKEN;
  delete process.env.GITHUB_OUTPUT;
});

/* -------------------------------- tests -------------------------------- */

describe('publish: a delegated PyPI package is not tagged here (#623)', () => {
  it('reports status=delegated and leaves the package untagged', async () => {
    seedRepo(PY_ONLY);
    mockNpm(0);

    const code = await run(['node', 'putitoutthere', 'publish', '--json', '--cwd', repo]);
    const out = stdout.join('');
    expect(code, out).toBe(0);

    const result = JSON.parse(out) as {
      published: Array<{ package: string; version: string; result: { status: string } }>;
    };
    const entry = result.published.find((p) => p.package === 'lib-py');
    expect(entry, out).toBeDefined();
    // Delegation is not a publish: nothing is on PyPI yet.
    expect(entry!.result.status).toBe('delegated');

    // ...so the tag — the record of what shipped — must not exist.
    expect(gitInRepo(['tag', '-l'])).toBe('');
  });

  it('announces the delegation on $GITHUB_OUTPUT without counting it as released', async () => {
    seedRepo(PY_ONLY);
    mockNpm(0);

    const code = await run(['node', 'putitoutthere', 'publish', '--cwd', repo]);
    expect(code, stdout.join('')).toBe(0);

    expect(ghOutputValue('delegated')).toBe('true');
    const delegated = JSON.parse(ghOutputValue('delegated_packages') ?? 'null') as Array<{
      name: string;
      version: string;
      tag: string;
    }>;
    expect(delegated).toHaveLength(1);
    expect(delegated[0]!.name).toBe('lib-py');
    expect(delegated[0]!.version).toMatch(/^\d+\.\d+\.\d+$/);
    // The tag the caller-side job will cut once the upload lands — the
    // canonical `formatTag` render, not a caller-side reconstruction.
    expect(delegated[0]!.tag).toBe(`lib-py-v${delegated[0]!.version}`);

    // Nothing shipped from this job, so the post-release outputs stay empty.
    expect(ghOutputValue('released')).toBe('false');
    expect(ghOutputValue('released_packages')).toBe('[]');
  });

  it('still announces the delegation when a later, unrelated handler fails', async () => {
    // The #623 repro: PyPI delegates, then npm dies on a missing scope.
    // The caller-side upload job must still be able to tell that PyPI's
    // own path got as far as delegating.
    seedRepo(PY_AND_JS);
    mockNpm(1);

    const code = await run(['node', 'putitoutthere', 'publish', '--cwd', repo]);
    expect(code).toBe(1);

    const delegated = JSON.parse(ghOutputValue('delegated_packages') ?? 'null') as Array<{
      name: string;
    }>;
    expect(delegated.map((d) => d.name)).toEqual(['lib-py']);
    expect(ghOutputValue('delegated')).toBe('true');

    // And the failed run left no PyPI tag behind.
    expect(gitInRepo(['tag', '-l'])).toBe('');
  });
});

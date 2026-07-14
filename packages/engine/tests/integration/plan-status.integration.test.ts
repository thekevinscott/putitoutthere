/**
 * `piot plan` — publish/skip verdict + dependency-skew view (integration).
 *
 * `plan` today emits the build matrix; the publish-vs-skip decision lives
 * in the publish path (`handler.isPublished`) and is surfaced nowhere
 * until a real publish runs. Slice 4 (#412) makes `plan` always answer
 * "what would a release from this ref actually ship?": per package,
 * PUBLISH (version not yet on the registry) vs SKIP (already published)
 * vs UNKNOWN (registry unreachable — reported, never aborts), plus a
 * dependency-skew warning when a package would PUBLISH while a
 * `depends_on` dependency SKIPs (the motivating incident's forward
 * consequence: dependents shipping ahead of a stuck dependency).
 *
 * Thin reader, no parallel logic (design-commitments #7): the real
 * planner (cascade + version) + the real `isPublished` the publish path
 * dispatches through. Only the registry HTTP boundary is mocked (msw);
 * config, plan, version, and handler dispatch are real. The build
 * `matrix` it emits is byte-identical to today's — verdicts are additive.
 * This is the e2e twin of `tests/e2e/plan-status.e2e.test.ts`.
 *
 * Issue #412, #403 slice 4.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

/* --------------------------- registry mock --------------------------- *
 * crates.io `isPublished` is GET /api/v1/crates/{name}/{version}:
 *   200 -> already published (SKIP), 404 -> not published (PUBLISH),
 *   5xx -> transient (rendered UNKNOWN). `published` holds `name@version`
 *   keys; `transient` holds crate names that 500.
 */
const published = new Set<string>();
const transient = new Set<string>();

const server = setupServer(
  http.get('https://crates.io/api/v1/crates/:name/:version', ({ params }) => {
    const name = String(params.name);
    const version = String(params.version);
    if (transient.has(name)) {
      return new HttpResponse('{"errors":[{"detail":"upstream"}]}', { status: 503 });
    }
    return published.has(`${name}@${version}`)
      ? HttpResponse.json({ version: { crate: name, num: version } })
      : new HttpResponse('{"errors":[{"detail":"Not Found"}]}', { status: 404 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/* ------------------------------- repo ------------------------------- */

let repo: string;
const stdoutChunks: string[] = [];

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeConfigAndCommit(body: string): void {
  writeFileSync(join(repo, 'putitoutthere.toml'), body, 'utf8');
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'config']);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-planstatus-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);

  stdoutChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  published.clear();
  transient.clear();
  rmSync(repo, { recursive: true, force: true });
});

interface PlanJson {
  matrix: Array<{ name: string; version: string }>;
  verdicts: Array<{ package: string; kind: string; version: string; verdict: string }>;
  skew: Array<{ dependent: string; dependency: string }>;
}

const TWO_PKG = `[putitoutthere]
version = 1
[[package]]
name  = "pub-lib"
kind  = "crates"
crate = "publib"
path  = "packages/pub"
globs = ["packages/pub/**"]
[[package]]
name  = "skip-lib"
kind  = "crates"
crate = "skiplib"
path  = "packages/skip"
globs = ["packages/skip/**"]
`;

const SKEW_PKG = `[putitoutthere]
version = 1
[[package]]
name  = "core"
kind  = "crates"
crate = "corecrate"
path  = "packages/core"
globs = ["packages/core/**"]
[[package]]
name  = "wrapper"
kind  = "crates"
crate = "wrappercrate"
path  = "packages/wrapper"
globs = ["packages/wrapper/**"]
depends_on = ["core"]
`;

describe('piot plan: publish/skip + skew (#412)', () => {
  it('reports SKIP for an already-published version and PUBLISH for a new one', async () => {
    writeConfigAndCommit(TWO_PKG);
    // skiplib@1.0.0 is live (→ SKIP); publib@1.0.0 is not (→ PUBLISH).
    published.add('skiplib@1.0.0');

    const code = await run([
      'node', 'piot', 'plan', '--json', '--cwd', repo,
      '--release-packages', 'pub-lib@1.0.0, skip-lib@1.0.0',
    ]);
    const out = JSON.parse(stdoutChunks.join('')) as PlanJson;
    expect(out.verdicts ?? null, 'plan --json must carry per-package verdicts').not.toBeNull();

    // The build matrix is unchanged — both packages are planned.
    expect(out.matrix.map((r) => r.name).sort()).toEqual(['pub-lib', 'skip-lib']);
    // ...and each carries the real publish/skip verdict.
    const byPkg = Object.fromEntries(out.verdicts.map((v) => [v.package, v]));
    expect(byPkg['pub-lib']).toMatchObject({ version: '1.0.0', verdict: 'publish' });
    expect(byPkg['skip-lib']).toMatchObject({ version: '1.0.0', verdict: 'skip' });
    expect(code).toBe(0);
  });

  it('flags dependency skew: a dependent PUBLISHes while its dependency SKIPs', async () => {
    writeConfigAndCommit(SKEW_PKG);
    // core@1.0.0 already live (SKIP); wrapper depends on core and would
    // PUBLISH 1.0.0 (not live) — the dangerous skew.
    published.add('corecrate@1.0.0');

    const code = await run([
      'node', 'piot', 'plan', '--json', '--cwd', repo,
      '--release-packages', 'core@1.0.0, wrapper@1.0.0',
    ]);
    const out = JSON.parse(stdoutChunks.join('')) as PlanJson;
    expect(out.verdicts ?? null, 'plan --json must carry per-package verdicts').not.toBeNull();

    const byPkg = Object.fromEntries(out.verdicts.map((v) => [v.package, v]));
    expect(byPkg['core']!.verdict).toBe('skip');
    expect(byPkg['wrapper']!.verdict).toBe('publish');
    expect(out.skew).toContainEqual({ dependent: 'wrapper', dependency: 'core' });
    expect(code).toBe(0);
  });

  it('renders UNKNOWN (and still emits the matrix) when the registry is unreachable', async () => {
    writeConfigAndCommit(TWO_PKG);
    // publib 5xxs; skiplib is live. A registry blip must not abort plan.
    transient.add('publib');
    published.add('skiplib@1.0.0');

    const code = await run([
      'node', 'piot', 'plan', '--json', '--cwd', repo,
      '--release-packages', 'pub-lib@1.0.0, skip-lib@1.0.0',
    ]);
    const out = JSON.parse(stdoutChunks.join('')) as PlanJson;
    expect(out.verdicts ?? null, 'plan --json must carry per-package verdicts').not.toBeNull();

    const byPkg = Object.fromEntries(out.verdicts.map((v) => [v.package, v]));
    expect(byPkg['pub-lib']!.verdict).toBe('unknown');
    expect(byPkg['skip-lib']!.verdict).toBe('skip');
    // The matrix is still emitted — the diagnostic degrades, never aborts.
    expect(out.matrix.length).toBeGreaterThan(0);
    expect(code).toBe(0);
  });
});

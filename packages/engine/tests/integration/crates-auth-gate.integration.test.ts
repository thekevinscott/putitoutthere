/**
 * `piot plan` must publish an "unpublished kinds" $GITHUB_OUTPUT key so the
 * reusable workflow can gate registry auth on *work left to do* rather than
 * on *packages that exist* (#622).
 *
 * The bug: `release.yml`'s `Authenticate with crates.io (OIDC)` step is gated
 * on `contains(needs.build.outputs.matrix, '"kind":"crates"')`, which asks
 * "does this repo have a crates package?". On a re-run whose crates version
 * is already live — the ordinary re-run-after-partial-failure state that
 * `isPublished` exists to make safe — the OIDC exchange still fires. When it
 * fails (no trusted publisher registered yet, or the record hasn't propagated)
 * the whole publish job dies before the engine action runs, taking npm and
 * PyPI down with it for crates.io work that will never happen.
 *
 * The fix hoists the determination the publish path already makes: `plan`
 * emits `unpublished_kinds`, the distinct kinds carrying at least one package
 * whose version is NOT already on the registry. `unknown` (registry
 * unreachable) counts as unpublished, so a blip never silently drops auth the
 * publish would then need.
 *
 * Only the registry boundary is mocked: crates.io over msw (fetch), npm via
 * `execFile` underneath the real process seam. Config, plan, cascade, version,
 * handler dispatch and the $GITHUB_OUTPUT write are all real. This is the
 * integration twin of `tests/e2e/crates-auth-gate.e2e.test.ts`.
 *
 * Issue #622.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run the first-party exec seam for real and mock only the
// Node built-in underneath it — mocking the seam module itself would trip the
// testing-conventions `no-first-party-mock` gate.
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

/* --------------------------- registry mocks --------------------------- */

/** `crate@version` keys that crates.io reports as live. */
const cratesPublished = new Set<string>();
/** Crate names whose crates.io read 5xxs (→ UNKNOWN verdict). */
const cratesTransient = new Set<string>();
/** `pkg@version` keys that `npm view` resolves. */
const npmPublished = new Set<string>();

const server = setupServer(
  http.get('https://crates.io/api/v1/crates/:name/:version', ({ params }) => {
    const name = String(params.name);
    if (cratesTransient.has(name)) {
      return new HttpResponse('{"errors":[{"detail":"upstream"}]}', { status: 503 });
    }
    return cratesPublished.has(`${name}@${String(params.version)}`)
      ? HttpResponse.json({ version: { crate: name, num: String(params.version) } })
      : new HttpResponse('{"errors":[{"detail":"Not Found"}]}', { status: 404 });
  }),
);

/** An execFile-child stand-in that emits `close` with `code`. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

/** `npm view <name>@<version> version` — exit 0 when live, non-zero otherwise. */
function wireNpm(): void {
  execMock.mockImplementation(((
    _cmd: string,
    args: readonly string[],
    _opts: unknown,
    cb: (e: Error | null, out: string, err: string) => void,
  ) => {
    const a = [...(args ?? [])] as string[];
    const spec = String(a[1] ?? '');
    const at = spec.lastIndexOf('@');
    const version = spec.slice(at + 1);
    if (a[0] === 'view' && npmPublished.has(spec)) {
      cb(null, `${version}\n`, '');
      return fakeChild(0);
    }
    cb(Object.assign(new Error('E404'), { code: 1 }), '', '404 not found');
    return fakeChild(1);
  }) as unknown as typeof execFile);
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/* -------------------------------- repo -------------------------------- */

let repo: string;
let outputFile: string;

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeConfigAndCommit(body: string): void {
  writeFileSync(join(repo, 'putitoutthere.toml'), body, 'utf8');
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'config']);
}

/**
 * The `key=value` lines `plan` appended to $GITHUB_OUTPUT, as a map.
 * Absent keys read as `undefined`, which is exactly what a workflow's
 * `needs.<job>.outputs.<key>` resolves to when the step never wrote it.
 */
function githubOutputs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(outputFile, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) {continue;}
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-cratesauth-int-'));
  outputFile = join(repo, 'gha-output.txt');
  writeFileSync(outputFile, '', 'utf8');
  process.env.GITHUB_OUTPUT = outputFile;

  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);

  wireNpm();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  delete process.env.GITHUB_OUTPUT;
  vi.restoreAllMocks();
  server.resetHandlers();
  cratesPublished.clear();
  cratesTransient.clear();
  npmPublished.clear();
  rmSync(repo, { recursive: true, force: true });
});

const RUST_ONLY = `[putitoutthere]
version = 1
[[package]]
name  = "lib-rust"
kind  = "crates"
crate = "libcrate"
path  = "packages/rust"
globs = ["packages/rust/**"]
`;

/** The issue's repro shape: a Rust crate alongside an npm package. */
const RUST_AND_NPM = `[putitoutthere]
version = 1
[[package]]
name  = "lib-rust"
kind  = "crates"
crate = "libcrate"
path  = "packages/rust"
globs = ["packages/rust/**"]
[[package]]
name  = "lib-js"
kind  = "npm"
npm   = "@scope/lib-js"
path  = "packages/js"
globs = ["packages/js/**"]
`;

async function planFor(spec: string): Promise<number> {
  return run(['node', 'piot', 'plan', '--cwd', repo, '--release-packages', spec]);
}

describe('#622 plan emits the kinds that still have something to publish', () => {
  it('omits crates when every planned crates version is already live', async () => {
    writeConfigAndCommit(RUST_ONLY);
    cratesPublished.add('libcrate@0.0.1');

    expect(await planFor('lib-rust@0.0.1')).toBe(0);

    const outputs = githubOutputs();
    expect(
      outputs.unpublished_kinds,
      'plan must emit an `unpublished_kinds` $GITHUB_OUTPUT key (#622)',
    ).toBeDefined();
    expect(
      JSON.parse(outputs.unpublished_kinds!) as string[],
      'libcrate@0.0.1 is already on crates.io — the run needs no crates.io credential',
    ).toEqual([]);
  });

  it('lists crates when the planned crates version is not yet live', async () => {
    writeConfigAndCommit(RUST_ONLY);

    expect(await planFor('lib-rust@0.0.1')).toBe(0);

    expect(JSON.parse(githubOutputs().unpublished_kinds!) as string[]).toEqual(['crates']);
  });

  it('lists only npm when the crates half is current and npm still has work (the #622 repro)', async () => {
    writeConfigAndCommit(RUST_AND_NPM);
    // The first run shipped the crate and died on npm. On the re-run the
    // crate is current and only npm is left — so the job must not demand a
    // working crates.io trusted publisher to finish npm.
    cratesPublished.add('libcrate@0.0.1');

    expect(await planFor('lib-rust@0.0.1, lib-js@0.0.1')).toBe(0);

    expect(JSON.parse(githubOutputs().unpublished_kinds!) as string[]).toEqual(['npm']);
  });

  it('keeps crates listed when the registry read is UNKNOWN', async () => {
    writeConfigAndCommit(RUST_ONLY);
    // A 5xx renders UNKNOWN. Dropping auth on "we could not tell" would turn
    // a registry blip into a missing credential at publish time, so the
    // conservative answer — today's behaviour — wins.
    cratesTransient.add('libcrate');

    expect(await planFor('lib-rust@0.0.1')).toBe(0);

    expect(JSON.parse(githubOutputs().unpublished_kinds!) as string[]).toEqual(['crates']);
  });

  it('still emits the byte-identical matrix alongside it', async () => {
    writeConfigAndCommit(RUST_AND_NPM);
    cratesPublished.add('libcrate@0.0.1');

    expect(await planFor('lib-rust@0.0.1, lib-js@0.0.1')).toBe(0);

    const outputs = githubOutputs();
    const matrix = JSON.parse(outputs.matrix!) as Array<{ name: string; kind: string }>;
    // The matrix contract the build job depends on is untouched: both
    // packages still build, only the *auth* gate narrows.
    expect(matrix.map((r) => r.name).sort()).toEqual(['lib-js', 'lib-rust']);
    expect(matrix.some((r) => r.kind === 'crates')).toBe(true);
  });
});

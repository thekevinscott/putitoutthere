/**
 * `piot verify npm-tarball` (epic #442, #443), extracted from two inline bash
 * blocks in `e2e-fixture-job.yml`. Two boundaries are faked: `fetch`, which
 * reads the per-version document for registry state (#716), and the Node
 * built-in `execFile` under the real exec seam, where `curl` is faked.
 * `tar` is the REAL binary, so extraction runs for real.
 */

import type * as ChildProcess from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Mock only the Node built-in (`execFile`) under the first-party exec seam,
// so the real seam runs (testing-conventions forbids mocking first-party
// modules in integration tests). Real `tar` (delegated to the un-mocked
// execFile) and real fs keep extraction and file I/O genuine; only `curl`
// is faked.
const realExecFile = (await vi.importActual<typeof ChildProcess>('node:child_process')).execFile;
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

// Prebuilt npm-style tarballs (top-level `package/` dir), built once with
// the REAL tar so the mocked `curl` can serve their bytes and the REAL
// `tar` (delegated below) can extract them.
let tgzRoot: string;
const tgz: Record<string, string> = {};

function buildTgz(label: string, files: Record<string, string>): string {
  const stage = mkdtempSync(join(tgzRoot, `${label}-`));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(stage, 'package', rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  const out = join(tgzRoot, `${label}.tgz`);
  execFileSync('tar', ['-czf', out, '-C', stage, 'package']);
  return out;
}

beforeAll(() => {
  tgzRoot = mkdtempSync(join(tmpdir(), 'piot-tgz-'));
  tgz.withDist = buildTgz('with-dist', {
    'package.json': '{"name":"@scope/pkg","version":"1.0.0"}',
    'dist/index.js': 'export const x = 1;\n',
  });
  tgz.noDist = buildTgz('no-dist', {
    'package.json': '{"name":"@scope/pkg","version":"1.0.0"}',
  });
  tgz.withBinary = buildTgz('with-binary', {
    'package.json': '{"name":"@scope/pkg-linux-x64-gnu","version":"1.0.0"}',
    'pkg.linux-x64-gnu.node': 'ELF...\n',
  });
  // A bundled-cli consumer whose build stages `bin/<binary>` rather than
  // flat: the tarball's top level is `package.json` plus the `bin/`
  // DIRECTORY, with the binary one level down (#633).
  tgz.nestedBinary = buildTgz('nested-binary', {
    'package.json': '{"name":"@scope/pkg-linux-x64-gnu","version":"1.0.0"}',
    'bin/pkg-linux-x64-gnu': '#!/bin/sh\necho hi\n',
  });
  tgz.onlyMeta = buildTgz('only-meta', {
    'package.json': '{"name":"@scope/pkg-linux-x64-gnu","version":"1.0.0"}',
  });
});

afterAll(() => {
  rmSync(tgzRoot, { recursive: true, force: true });
});

/**
 * The path a `<name>@<version>` spec's per-version document occupies — `@`
 * literal, `/` percent-encoded. Matched as a SUFFIX below so one wiring
 * serves both the Verdaccio and real-npm bases.
 */
function versionDocPath(spec: string): string {
  const at = spec.lastIndexOf('@');
  return `/${encodeURIComponent(spec.slice(0, at)).replaceAll('%40', '@')}/${spec.slice(at + 1)}`;
}

/**
 * Wire both registry boundaries for the happy path. `published` maps
 * `name@version` to the tarball URL its per-version document advertises (#716);
 * a spec that is absent — or mapped to `''` — gets the registry's 404.
 * `urlToTgz` maps a served URL to one of the prebuilt tarball paths the mocked
 * `curl` copies out. The `npm view` branch is deliberately NOT faked: a
 * regression back to the packument should reach the real network and fail
 * loudly rather than be answered by a double.
 */
function wire(published: Record<string, string>, urlToTgz: Record<string, string>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL) => {
    const url = String(input);
    fetched.push(url);
    const hit = Object.entries(published).find(([spec]) => url.endsWith(versionDocPath(spec)));
    if (hit === undefined || hit[1] === '') {
      return Promise.resolve(new Response('"version not found"', { status: 404 }));
    }
    const body = JSON.stringify({ dist: { tarball: hit[1] } });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as unknown as typeof fetch);

  execMock.mockImplementation(((cmd: string, args: readonly string[], opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const a = [...(args ?? [])];
    if (cmd === 'curl') {
      const url = a[a.length - 1]!;
      const outIdx = a.indexOf('-o');
      const dest = a[outIdx + 1]!;
      cpSync(urlToTgz[url]!, dest);
      cb(null, '', '');
      return undefined as unknown as ChildProcess.ChildProcess;
    }
    // Real tar for extraction — delegate to the un-mocked execFile.
    return (realExecFile as unknown as (...x: unknown[]) => ChildProcess.ChildProcess)(cmd, a, opts, cb);
  }) as unknown as typeof execFile);
}

/**
 * Wire the `fetch` boundary for npm's per-version document, `GET
 * <registry>/<name>/<version>` (#716). Keyed by the exact URL; the value is a
 * queue of responses, the last of which repeats. A URL with no entry answers
 * 404, which is what the registry says for a version that was never
 * published. Every requested URL is appended to `fetched`, so a test can
 * assert how many reads the resolve actually made.
 */
function wireVersionDocs(docs: Record<string, Array<{ status: number; json?: unknown }>>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(((input: string | URL) => {
    const url = String(input);
    fetched.push(url);
    const queue = docs[url];
    const next = queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0];
    if (next === undefined) {
      return Promise.resolve(new Response('"version not found"', { status: 404 }));
    }
    const body = next.json === undefined ? '' : JSON.stringify(next.json);
    return Promise.resolve(new Response(body, { status: next.status }));
  }) as unknown as typeof fetch);
}

/**
 * Drive a `run()` whose retry loop `await`s real-second sleeps without
 * waiting real seconds. The engine is async end to end: each retry's
 * registry read and the surrounding real-fs reads resolve as microtasks /
 * real I/O, so a retry's sleep timer is only scheduled after those settle —
 * a single `runAllTimersAsync()` would see no timer yet and return early.
 * Instead, loop: fast-forward past the longest sleep (30s) and flush a
 * microtask each turn, letting the real fs reads and the next scheduled
 * sleep land, until the run settles.
 */
async function withFakeTimers(fn: () => Promise<number>): Promise<number> {
  vi.useFakeTimers();
  try {
    const p = fn();
    let done = false;
    void p.then(
      () => { done = true; },
      () => { done = true; },
    );
    while (!done) {
      await vi.advanceTimersByTimeAsync(200_000);
      await Promise.resolve();
    }
    return await p;
  } finally {
    vi.useRealTimers();
  }
}

let repo: string;
const out: string[] = [];
const fetched: string[] = [];

beforeEach(() => {
  execMock.mockReset();
  repo = mkdtempSync(join(tmpdir(), 'piot-npmtar-'));
  out.length = 0;
  fetched.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

function writePkg(relDir: string, pkg: object, dirs: Record<string, string> = {}): void {
  const dir = join(repo, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [d, file] of Object.entries(dirs)) {
    mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, d, file), 'local\n');
  }
}

function mainRow(over: object = {}): object {
  return { name: '@scope/pkg', kind: 'npm', version: '1.0.0', target: 'main', path: 'packages/npm', ...over };
}

describe('piot verify npm-tarball: main/noarch files[] (#443)', () => {
  it('passes when the published tarball contains every declared files[] dir', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    wire({ '@scope/pkg@1.0.0': 'https://reg/pkg.tgz' }, { 'https://reg/pkg.tgz': tgz.withDist! });

    const code = await run([
      'node', 'piot', 'verify', 'npm-tarball',
      '--registry', 'http://localhost:4873',
      '--matrix', JSON.stringify([mainRow()]),
      '--cwd', repo,
    ]);

    const text = out.join('');
    expect(text).toContain('ok: package/dist/ (1 file(s))');
    expect(code).toBe(0);
  });

  it('skips rows whose files[] declares no directory entries', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['README.md'] });
    wire({}, {});

    const code = await run([
      'node', 'piot', 'verify', 'npm-tarball',
      '--registry', 'http://localhost:4873',
      '--matrix', JSON.stringify([mainRow()]),
      '--cwd', repo,
    ]);

    expect(out.join('')).toContain('[@scope/pkg@1.0.0] no directory entries in files[]; skipping.');
    expect(code).toBe(0);
  });

  it('fails with the local-state error when the tarball is missing a declared dir', async () => {
    // The load-bearing bug: dist/ exists in the local tree but the
    // published tarball shipped without it.
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    wire({ '@scope/pkg@1.0.0': 'https://reg/pkg.tgz' }, { 'https://reg/pkg.tgz': tgz.noDist! });

    const code = await run([
      'node', 'piot', 'verify', 'npm-tarball',
      '--registry', 'http://localhost:4873',
      '--matrix', JSON.stringify([mainRow()]),
      '--cwd', repo,
    ]);

    const text = out.join('');
    expect(text).toContain("tarball missing 'dist'");
    expect(text).toContain(`local ${join(repo, 'packages/npm')}/dist: present, 1 file(s)`);
    expect(code).toBe(1);
  });
});

describe('piot verify npm-tarball --per-triple: synthesized binary presence (#443)', () => {
  it('passes when the per-triple tarball ships a non-metadata file', async () => {
    wire({ '@scope/pkg-linux-x64-gnu@1.0.0': 'https://reg/triple.tgz' }, { 'https://reg/triple.tgz': tgz.withBinary! });

    const code = await run([
      'node', 'piot', 'verify', 'npm-tarball', '--per-triple',
      '--registry', 'http://localhost:4873',
      '--matrix', JSON.stringify([mainRow({ target: 'linux-x64-gnu' })]),
      '--cwd', repo,
    ]);

    const text = out.join('');
    expect(text).toContain('ok: 1 non-metadata file(s):');
    expect(code).toBe(0);
  });

  it('passes when the per-triple tarball stages its binary nested under bin/ (#633)', async () => {
    // The nested layout is legal all the way to publish — `checkCompleteness`
    // lists recursively, so it accepts either shape — but this verify step
    // counted only top-level FILES, so `bin/` (a directory) didn't count and
    // the step failed a tarball whose binary is right there at `package/bin/`.
    wire({ '@scope/pkg-linux-x64-gnu@1.0.0': 'https://reg/nested.tgz' }, { 'https://reg/nested.tgz': tgz.nestedBinary! });

    const code = await run([
      'node', 'piot', 'verify', 'npm-tarball', '--per-triple',
      '--registry', 'http://localhost:4873',
      '--matrix', JSON.stringify([mainRow({ target: 'linux-x64-gnu' })]),
      '--cwd', repo,
    ]);

    const text = out.join('');
    expect(text, `output:\n${text}`).toContain('ok: 1 non-metadata file(s): bin/pkg-linux-x64-gnu');
    expect(code).toBe(0);
  });

  it('fails when the per-triple tarball contains only package.json', async () => {
    wire({ '@scope/pkg-linux-x64-gnu@1.0.0': 'https://reg/triple.tgz' }, { 'https://reg/triple.tgz': tgz.onlyMeta! });

    const code = await run([
      'node', 'piot', 'verify', 'npm-tarball', '--per-triple',
      '--registry', 'http://localhost:4873',
      '--matrix', JSON.stringify([mainRow({ target: 'linux-x64-gnu' })]),
      '--cwd', repo,
    ]);

    expect(out.join('')).toContain('tarball contains only package.json');
    expect(code).toBe(1);
  });
});

/**
 * #716. `npm view` reads the MUTABLE packument (`GET /<name>`), a
 * cache-fronted discovery view that lagged a completed publish by 46s / 103s
 * / 110s past a 320s budget on three live e2e runs in two days — so the gate
 * failed publishes that had succeeded, on a lane that cannot be rerun. The
 * per-version document (`GET /<name>/<version>`) is written at publish time
 * and is never stale-but-present, so it answers the question the gate is
 * actually asking and a 404 from it is a verdict rather than lag.
 */
describe('piot verify npm-tarball: resolves off the immutable per-version document (#716)', () => {
  const VERSION_DOC = 'https://registry.npmjs.org/@scope%2Fpkg/1.0.0';

  it('verifies a published version the mutable packument cannot see yet', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    // The exact #716 shape: the publish landed, so the per-version document
    // has it, while `npm view` stays empty for minutes afterwards.
    wire({ '@scope/pkg@1.0.0': '' }, { 'https://reg/pkg.tgz': tgz.withDist! });
    wireVersionDocs({ [VERSION_DOC]: [{ status: 200, json: { dist: { tarball: 'https://reg/pkg.tgz' } } }] });

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball',
        '--matrix', JSON.stringify([mainRow()]),
        '--cwd', repo,
      ]),
    );

    const text = out.join('');
    expect(text, `output:\n${text}`).toContain('ok: package/dist/ (1 file(s))');
    expect(code).toBe(0);
    // One read answers it; no propagation budget is spent.
    expect(fetched).toEqual([VERSION_DOC]);
  });

  it('reads the per-version document at the --registry override, scoped name encoded', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    wire({ '@scope/pkg@1.0.0': '' }, { 'https://reg/pkg.tgz': tgz.withDist! });
    wireVersionDocs({
      'http://localhost:4873/@scope%2Fpkg/1.0.0': [
        { status: 200, json: { dist: { tarball: 'https://reg/pkg.tgz' } } },
      ],
    });

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball',
        '--registry', 'http://localhost:4873',
        '--matrix', JSON.stringify([mainRow()]),
        '--cwd', repo,
      ]),
    );

    expect(out.join('')).toContain('ok: package/dist/ (1 file(s))');
    expect(code).toBe(0);
    expect(fetched).toEqual(['http://localhost:4873/@scope%2Fpkg/1.0.0']);
  });

  it('calls a 404 from the per-version document a failed publish, on the first read', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    wire({ '@scope/pkg@1.0.0': '' }, {});
    // No entry → 404, i.e. npm has no record of the version at all.
    wireVersionDocs({});

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball',
        '--matrix', JSON.stringify([mainRow()]),
        '--cwd', repo,
      ]),
    );

    const text = out.join('');
    // Self-diagnosing: names the endpoint, the status, and the one reading
    // they imply — the old message asked the reader to choose between "didn't
    // publish" and "propagation is slow" and gave them nothing to choose with.
    expect(text, `output:\n${text}`).toContain(VERSION_DOC);
    expect(text).toContain('404');
    expect(text).toContain('immutable');
    expect(code).toBe(1);
    // The decisive point: ONE read, not a retry budget. A 404 here cannot be
    // propagation lag, so waiting it out only delays the same answer.
    expect(fetched).toEqual([VERSION_DOC]);
  });

  it('retries an unreadable registry, then verifies once the read succeeds', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    wire({ '@scope/pkg@1.0.0': '' }, { 'https://reg/pkg.tgz': tgz.withDist! });
    wireVersionDocs({
      [VERSION_DOC]: [
        { status: 503 },
        { status: 200, json: { dist: { tarball: 'https://reg/pkg.tgz' } } },
      ],
    });

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball',
        '--matrix', JSON.stringify([mainRow()]),
        '--cwd', repo,
      ]),
    );

    const text = out.join('');
    expect(text, `output:\n${text}`).toContain('registry read failed (attempt 1/6): HTTP 503; retrying in 2s');
    expect(text).toContain('ok: package/dist/ (1 file(s))');
    expect(code).toBe(0);
    expect(fetched).toEqual([VERSION_DOC, VERSION_DOC]);
  });

  it('fails with the last read failure when the registry stays unreadable', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    wire({ '@scope/pkg@1.0.0': '' }, {});
    wireVersionDocs({ [VERSION_DOC]: [{ status: 500 }] });

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball',
        '--matrix', JSON.stringify([mainRow()]),
        '--cwd', repo,
      ]),
    );

    const text = out.join('');
    expect(text, `output:\n${text}`).toContain(`could not read ${VERSION_DOC} after 6 attempts`);
    expect(text).toContain('last failure: HTTP 500');
    expect(code).toBe(1);
    expect(fetched).toHaveLength(6);
  });

  it('resolves per-triple tarballs off the per-version document too', async () => {
    wire({ '@scope/pkg-linux-x64-gnu@1.0.0': '' }, { 'https://reg/triple.tgz': tgz.withBinary! });
    wireVersionDocs({
      'http://localhost:4873/@scope%2Fpkg-linux-x64-gnu/1.0.0': [
        { status: 200, json: { dist: { tarball: 'https://reg/triple.tgz' } } },
      ],
    });

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball', '--per-triple',
        '--registry', 'http://localhost:4873',
        '--matrix', JSON.stringify([mainRow({ target: 'linux-x64-gnu' })]),
        '--cwd', repo,
      ]),
    );

    const text = out.join('');
    expect(text, `output:\n${text}`).toContain('ok: 1 non-metadata file(s):');
    expect(code).toBe(0);
    expect(fetched).toEqual(['http://localhost:4873/@scope%2Fpkg-linux-x64-gnu/1.0.0']);
  });
});

/**
 * `piot verify npm-tarball` — published-artifact `files[]` verification
 * (integration).
 *
 * Extraction of the two inline bash blocks in
 * `.github/workflows/e2e-fixture-job.yml` ("Verify published npm tarballs
 * honor package.json files" + its per-triple near-duplicate) into one
 * tested engine subcommand (epic #442, sub-issue #443).
 *
 * The subcommand shells out to `npm view` (tarball URL), `curl`
 * (download) and `tar` (extract); this tier mocks only that subprocess
 * boundary. `npm view` + `curl` are faked (registry state); `tar` is the
 * REAL binary, so extraction is exercised for real. The e2e twin
 * (`test/e2e/verify-npm-tarball.e2e.test.ts`) shells out to the built CLI
 * against the real `@putitoutthere/piot-fixture-zzz-js-vanilla` package.
 *
 * Contract preserved verbatim from the bash: same row selection, same
 * `::error::` strings, same stdout, same exit code.
 */

import type * as ChildProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const execMock = vi.mocked(execFileSync);

// Prebuilt npm-style tarballs (top-level `package/` dir), built once with
// the REAL tar so the mocked `curl` can serve their bytes and the REAL
// `tar` (delegated below) can extract them.
let realExec: typeof execFileSync;
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
  realExec('tar', ['-czf', out, '-C', stage, 'package']);
  return out;
}

beforeAll(async () => {
  const cp = await vi.importActual<typeof ChildProcess>('node:child_process');
  realExec = cp.execFileSync;
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
  tgz.onlyMeta = buildTgz('only-meta', {
    'package.json': '{"name":"@scope/pkg-linux-x64-gnu","version":"1.0.0"}',
  });
});

afterAll(() => {
  rmSync(tgzRoot, { recursive: true, force: true });
});

/**
 * Wire the subprocess boundary. `viewUrls` maps `name@version` (the exact
 * `npm view` first-arg) to the tarball URL it returns; an entry may be an
 * array to model packument lag — successive `npm view` calls shift off the
 * front, `''` meaning "not yet propagated". `urlToTgz` maps a served URL to
 * one of the prebuilt tarball paths the mocked `curl` copies out.
 */
function wire(
  viewUrls: Record<string, string | string[]>,
  urlToTgz: Record<string, string>,
): void {
  execMock.mockImplementation((cmd, args, opts) => {
    const a = (args ?? []) as string[];
    if (a[0] === 'view') {
      // `npm view <spec> dist.tarball [--registry …]` — the spec sits
      // right before `dist.tarball`. `npm view` is invoked with
      // `encoding: 'utf8'`, so return a string, not a Buffer.
      const key = a[a.indexOf('dist.tarball') - 1]!;
      const entry = viewUrls[key];
      if (Array.isArray(entry)) return `${entry.shift() ?? ''}\n`;
      return `${entry ?? ''}\n`;
    }
    if (cmd === 'curl') {
      const url = a[a.length - 1]!;
      const outIdx = a.indexOf('-o');
      const dest = a[outIdx + 1]!;
      cpSync(urlToTgz[url]!, dest);
      return Buffer.from('');
    }
    // Real tar for extraction — the whole point of this tier.
    return realExec(cmd, args as string[], opts as ChildProcess.ExecFileSyncOptions);
  });
}

/**
 * Drive a `run()` whose retry loop `await`s real-second sleeps without
 * waiting real seconds: fake the timers, kick off the run, flush every
 * pending timer + microtask, then await the result.
 */
async function withFakeTimers(fn: () => Promise<number>): Promise<number> {
  vi.useFakeTimers();
  try {
    const p = fn();
    await vi.runAllTimersAsync();
    return await p;
  } finally {
    vi.useRealTimers();
  }
}

let repo: string;
const out: string[] = [];

beforeEach(() => {
  execMock.mockReset();
  repo = mkdtempSync(join(tmpdir(), 'piot-npmtar-'));
  out.length = 0;
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

  it('fails when npm view never returns a tarball URL', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    // Empty forever → exhausts the retry schedule (driven by fake timers).
    wire({ '@scope/pkg@1.0.0': '' }, {});

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball',
        '--registry', 'http://localhost:4873',
        '--matrix', JSON.stringify([mainRow()]),
        '--cwd', repo,
      ]),
    );

    expect(out.join('')).toContain('never returned a tarball URL');
    expect(code).toBe(1);
  });

  it('retries through packument lag, then verifies once the URL appears', async () => {
    writePkg('packages/npm', { name: '@scope/pkg', files: ['dist'] }, { dist: 'index.js' });
    // Empty on the first view, URL on the second → one retry sleep.
    wire({ '@scope/pkg@1.0.0': ['', 'https://reg/pkg.tgz'] }, { 'https://reg/pkg.tgz': tgz.withDist! });

    const code = await withFakeTimers(() =>
      run([
        'node', 'piot', 'verify', 'npm-tarball',
        '--registry', 'http://localhost:4873',
        '--matrix', JSON.stringify([mainRow()]),
        '--cwd', repo,
      ]),
    );

    const text = out.join('');
    expect(text).toContain('packument lag: npm view returned empty (attempt 1/5)');
    expect(text).toContain('ok: package/dist/ (1 file(s))');
    expect(code).toBe(0);
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

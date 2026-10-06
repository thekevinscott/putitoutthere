/**
 * Integration test for the pypi-tag-verify harness (#718). Drives the real
 * `piot-ci pypi-tag-verify <mode>` dispatch in-process with only the OS
 * boundary mocked, so the expectation the e2e `pypi-tag` job hands to
 * `reconcile --expect` is asserted through the command rather than against a
 * mocked decision.
 *
 * What the gate exists to protect: `reconcile --expect` fails loudly for a
 * version PyPI does not confirm, but it is a silent no-op for an expectation
 * that is *empty* — which is exactly the shape a mis-derived artifact list
 * takes. So the derivation is the part worth testing at this tier, and the
 * tag read-back is the part that proves the upload was observed at all.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

// Integration tests run first-party code (the exec seam) for real and mock
// only the platform boundaries underneath: `execFile` (what `execCapture`
// uses, for `git ls-remote`) and `spawn` (what `execInherit` uses, for the
// throwaway repo's git steps). Mocking the seam modules themselves would
// trip the testing-conventions `no-first-party-mock` gate.
vi.mock('node:fs/promises');
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});

const execFileMock = vi.mocked(execFile);
const spawnMock = vi.mocked(spawn);
const readdirMock = vi.mocked(readdir);
let out: string[];

/** The throwaway tree the workflow hands both modes, outside the checkout. */
const TREE = '/runner/_temp/piot-pypi-tag';
const VERSION = '0.0.1700000000';

/**
 * A plausible `dist/` after `pypi-publish` downloaded every `*-sdist` /
 * `*-wheel-*` artifact and #294 dropped the first-publish ones. Two projects,
 * one of them multi-wheel, plus a `_placeholder` sdist that never reached
 * PyPI — `reconcile --expect` would hard-fail on its version.
 */
const DIST_FILES = [
  `piot_fixture_zzz_python_hatch-${VERSION}.tar.gz`,
  `piot_fixture_zzz_python_hatch-${VERSION}-py3-none-any.whl`,
  `piot_fixture_zzz_python_maturin-${VERSION}.tar.gz`,
  `piot_fixture_zzz_python_maturin-${VERSION}-cp312-abi3-manylinux_2_28_x86_64.whl`,
  `piot_fixture_zzz_python_maturin-${VERSION}-cp312-abi3-macosx_11_0_arm64.whl`,
  `piot_fixture_zzz_python_placeholder-${VERSION}.tar.gz`,
];

const EXPECTED = [
  {
    name: 'piot-fixture-zzz-python-hatch',
    version: VERSION,
    tag: `piot-fixture-zzz-python-hatch-v${VERSION}`,
  },
  {
    name: 'piot-fixture-zzz-python-maturin',
    version: VERSION,
    tag: `piot-fixture-zzz-python-maturin-v${VERSION}`,
  },
];

/** A minimal spawn() stand-in that emits `close` with `code` on the next tick. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

function fileDirent(name: string): { name: string; isFile: () => boolean } {
  return { name, isFile: () => true };
}

function stubDist(names: readonly string[]): void {
  readdirMock.mockResolvedValue(
    names.map(fileDirent) as unknown as Awaited<ReturnType<typeof readdir>>,
  );
}

/** Resolve every `execCapture` (mocked at `execFile`) with `stdout`. */
function stubCapture(stdout: string): void {
  execFileMock.mockImplementation(((
    _cmd: string,
    _args: readonly string[],
    _opts: unknown,
    cb: (e: Error | null, o: string, e2: string) => void,
  ) => {
    cb(null, stdout, '');
    return undefined as unknown as ChildProcess.ChildProcess;
  }) as unknown as typeof execFile);
}

/** The args of every git subprocess `execInherit` spawned, in order. */
function gitCalls(): string[][] {
  return spawnMock.mock.calls.map((call) => [...(call[1] as string[])]);
}

beforeEach(() => {
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  spawnMock.mockImplementation((() => fakeChild(0)) as unknown as typeof spawn);
  stubDist(DIST_FILES);
  process.env.TAG_TREE = TREE;
  process.env.GITHUB_OUTPUT = '/gh-output';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TAG_TREE;
  delete process.env.GITHUB_OUTPUT;
});

const verify = (mode: string): Promise<number> =>
  run(['node', 'piot-ci', 'pypi-tag-verify', mode]);

describe('piot-ci pypi-tag-verify (integration)', () => {
  it('prepare derives one expectation per uploaded project and exports it', async () => {
    await expect(verify('prepare')).resolves.toBe(0);

    // Shape-identical to release.yml's `delegated_packages`, so the e2e job
    // forwards it through the same `expect:` input a consumer does.
    expect(appendFile).toHaveBeenCalledWith(
      '/gh-output',
      `expect=${JSON.stringify(EXPECTED)}\n`,
    );
  });

  it('prepare writes a throwaway repo whose config names those projects', async () => {
    await expect(verify('prepare')).resolves.toBe(0);

    // Under RUNNER_TEMP, outside the checkout: a tree with no `.git` would
    // otherwise let git walk up and tag the real repository.
    expect(rm).toHaveBeenCalledWith(TREE, { recursive: true, force: true });
    expect(rm).toHaveBeenCalledWith(`${TREE}-origin`, { recursive: true, force: true });
    expect(mkdir).toHaveBeenCalledWith(TREE, { recursive: true });

    const [path, contents] = vi.mocked(writeFile).mock.calls[0] ?? [];
    expect(path).toBe(`${TREE}/putitoutthere.toml`);
    expect(String(contents)).toContain('name = "piot-fixture-zzz-python-hatch"');
    expect(String(contents)).toContain('name = "piot-fixture-zzz-python-maturin"');
    expect(String(contents)).not.toContain('placeholder');

    // `ensureTag` tags a commit, so the tree needs a HEAD. Its origin is a
    // local bare repo beside the tree, so a tag push cannot escape the runner.
    const git = gitCalls();
    expect(git[0]).toEqual(['init', '-q', '-b', 'main']);
    expect(git).toContainEqual(['commit', '-q', '-m', 'e2e: pypi-tag fixture']);
    expect(git.at(-2)).toEqual(['init', '-q', '--bare', `${TREE}-origin`]);
    expect(git.at(-1)).toEqual(['remote', 'add', 'origin', `${TREE}-origin`]);
  });

  it('prepare refuses a dist/ whose artifacts disagree on a version', async () => {
    stubDist([
      `piot_fixture_zzz_python_hatch-${VERSION}.tar.gz`,
      'piot_fixture_zzz_python_hatch-0.0.9-py3-none-any.whl',
    ]);

    await expect(verify('prepare')).resolves.toBe(1);
    expect(out.join('')).toContain('::error::');
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('prepare refuses an empty expectation rather than exporting one', async () => {
    // The job only runs when `have_pypi` said something was uploaded, so
    // nothing publishable here means the derivation is wrong — and an empty
    // `--expect` is a silent no-op, not a failure, downstream.
    stubDist([`piot_fixture_zzz_python_placeholder-${VERSION}.tar.gz`]);

    await expect(verify('prepare')).resolves.toBe(1);
    expect(out.join('')).toContain('::error::');
    expect(appendFile).not.toHaveBeenCalled();
  });

  it('assert passes when every uploaded version got a tag on origin', async () => {
    stubCapture(`aaa\trefs/tags/${EXPECTED[0]?.tag}\nbbb\trefs/tags/${EXPECTED[1]?.tag}\n`);

    await expect(verify('assert')).resolves.toBe(0);
    expect(execFileMock.mock.calls[0]?.[0]).toBe('git');
    expect(execFileMock.mock.calls[0]?.[1]).toEqual(['ls-remote', '--tags', '--refs', 'origin']);
  });

  it('assert fails, naming the version, when reconcile cut no tag', async () => {
    // #694 verbatim: reconcile exits 0 reporting nothing to do, the version
    // is on PyPI, and no tag exists. Without this read-back the lane is green.
    stubCapture(`aaa\trefs/tags/${EXPECTED[0]?.tag}\n`);

    await expect(verify('assert')).resolves.toBe(1);
    const printed = out.join('');
    expect(printed).toContain('::error::');
    expect(printed).toContain('piot-fixture-zzz-python-maturin');
    expect(printed).toContain(VERSION);
  });

  it('rejects an unknown mode', async () => {
    await expect(verify('tag')).resolves.toBe(1);
    expect(out.join('')).toContain('::error::');
  });
});

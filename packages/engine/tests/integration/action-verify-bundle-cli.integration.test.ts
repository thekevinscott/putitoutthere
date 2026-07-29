/**
 * `command: verify-bundle-cli` through the GitHub Action adapter (#595).
 *
 * `_matrix.yml` is a **reusable** workflow: its jobs check out the
 * *consumer's* repo, so the engine is reachable there only as
 * `uses: thekevinscott/putitoutthere@v0` — never `pnpm exec putitoutthere`.
 * `action.yml` had no `verify` surface, which is exactly why the
 * "bundle_cli — verify wheel contains <stage_to>/<bin>" step still carried
 * an inline `python3 - <<PY … import tomllib … PY` heredoc parsing
 * `[tool.maturin].python-source` from the consumer's pyproject — a third
 * copy of logic the engine already owns (`readPythonSource` +
 * `computeStageSuffix`), and one that runs under whatever interpreter the
 * wheel row provisioned. `tomllib` is stdlib only on CPython >= 3.11, so
 * every maturin wheel row with a <= 3.10 floor crashed the release build
 * (#595 defect 1).
 *
 * This tier drives the **adapter itself** — `main()` from `src/action.ts`,
 * in-process, with the real dispatcher (`run`) behind it, against real
 * deflate `.whl` files and a real `pyproject.toml` on disk. That is the
 * whole point: the python-source parse must now happen in Node, inside the
 * engine, with no Python interpreter in the picture at any version. The
 * e2e twin (`tests/e2e/action-verify-bundle-cli.e2e.test.ts`) runs the
 * ncc-bundled action as a real subprocess against a wheel downloaded from
 * PyPI.
 *
 * Red before the surface exists: `verify-bundle-cli` is not a command the
 * adapter shapes argv for, so it falls through to the generic branch, `run`
 * rejects it as unknown, and no `ok bundle_cli:` line is ever emitted.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../../src/action.js';
import { zip } from './zip-wheel.js';

const NON_WINDOWS = 'x86_64-unknown-linux-gnu';
const WINDOWS = 'x86_64-pc-windows-msvc';

let pkg: string;
const out: string[] = [];

/** Write a real deflate `.whl` under `<pkg>/dist`, where maturin puts it. */
function writeWheel(entries: Record<string, string>): void {
  const dist = join(pkg, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'demo-1.0.0-cp312-cp312-linux_x86_64.whl'), zip(entries));
}

function writePyproject(body: string): void {
  writeFileSync(join(pkg, 'pyproject.toml'), body);
}

/**
 * Invoke the adapter exactly as `_matrix.yml`'s step does: `command` plus
 * the `working_directory` / `stage_to` / `bin` / `target` inputs. Returns
 * the process exit code the adapter surfaced.
 */
async function runAction(
  stageTo: string,
  bin: string,
  target = NON_WINDOWS,
): Promise<number> {
  process.env.INPUT_COMMAND = 'verify-bundle-cli';
  process.env.INPUT_WORKING_DIRECTORY = pkg;
  process.env.INPUT_STAGE_TO = stageTo;
  process.env.INPUT_BIN = bin;
  process.env.INPUT_TARGET = target;
  // `main()` always terminates via process.exit; the mock below turns that
  // into a throw carrying the code so the assertions can read it.
  try {
    await main();
  } catch (err) {
    const m = /^exit:(\d+)$/.exec((err as Error).message);
    if (!m) {throw err;}
    return Number(m[1]);
  }
  throw new Error('action returned without exiting');
}

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-action-bundle-cli-'));
  out.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    out.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as typeof process.exit);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(pkg, { recursive: true, force: true });
  delete process.env.INPUT_COMMAND;
  delete process.env.INPUT_WORKING_DIRECTORY;
  delete process.env.INPUT_STAGE_TO;
  delete process.env.INPUT_BIN;
  delete process.env.INPUT_TARGET;
  delete process.env.INPUT_FAIL_ON_ERROR;
});

describe('action command: verify-bundle-cli (#595)', () => {
  it('verifies the staged binary in the wheel and exits 0', async () => {
    writeWheel({
      'demo/__init__.py': '\n',
      'dirsql/_binary/dirsql': 'ELF...',
      'demo-1.0.0.dist-info/METADATA': 'Name: demo\n',
    });

    const code = await runAction('dirsql/_binary', 'dirsql');

    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('subtracts [tool.maturin].python-source without invoking Python', async () => {
    // The defect #595 exists for: maturin strips `python-source` from the
    // wheel layout, so a binary staged on disk at `python/dirsql/_binary/`
    // lands at `dirsql/_binary/` in the wheel. The heredoc read this with
    // `tomllib` under the wheel row's interpreter; the engine reads it with
    // smol-toml under the action's own Node, so no `requires-python` floor
    // can break it.
    writePyproject('[tool.maturin]\npython-source = "python"\n');
    writeWheel({ 'dirsql/_binary/dirsql': 'ELF...' });

    const code = await runAction('python/dirsql/_binary', 'dirsql');

    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('honors the legacy python_source spelling', async () => {
    writePyproject('[tool.maturin]\npython_source = "python"\n');
    writeWheel({ 'dirsql/_binary/dirsql': 'ELF...' });

    const code = await runAction('python/dirsql/_binary', 'dirsql');

    expect(out.join('')).toContain('ok bundle_cli: dirsql/_binary/dirsql present in');
    expect(code).toBe(0);
  });

  it('appends .exe on a Windows target', async () => {
    writeWheel({ 'stage/bin/mytool.exe': 'MZ...' });

    const code = await runAction('stage/bin', 'mytool', WINDOWS);

    expect(out.join('')).toContain('ok bundle_cli: stage/bin/mytool.exe present in');
    expect(code).toBe(0);
  });

  it('fails the step when the wheel is missing its bundle_cli binary', async () => {
    // The whole reason the step exists: a build that silently failed to
    // stage the binary must not go green and ship a broken wheel.
    writeWheel({
      'demo/__init__.py': '\n',
      'demo-1.0.0.dist-info/METADATA': 'Name: demo\n',
    });

    const code = await runAction('dirsql/_binary', 'dirsql');

    expect(out.join('')).toContain('::error::');
    expect(out.join('')).toContain('missing bundle_cli binary at dirsql/_binary/dirsql');
    expect(code).toBe(1);
  });
});

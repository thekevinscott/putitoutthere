/**
 * `verify-bundle-cli` through the GitHub Action adapter (#595). `_matrix.yml`
 * is reusable, so the engine is reachable only as `uses:` — and the step it
 * replaced parsed pyproject in an inline `tomllib` heredoc, which is stdlib
 * only on CPython >= 3.11, so every wheel row with a <= 3.10 floor crashed.
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
  // The callback must fire: the adapter awaits `flushStdio` before each exit
  // (#664), so a mock that only returns `true` would park `main()` forever.
  vi.spyOn(process.stdout, 'write').mockImplementation(((
    c: unknown,
    cb?: () => void,
  ) => {
    out.push(typeof c === 'string' ? c : String(c));
    cb?.();
    return true;
  }) as unknown as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation(((
    c: unknown,
    cb?: () => void,
  ) => {
    out.push(typeof c === 'string' ? c : String(c));
    cb?.();
    return true;
  }) as unknown as typeof process.stderr.write);
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

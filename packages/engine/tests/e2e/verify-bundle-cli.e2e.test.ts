/**
 * `verify bundle-cli` against a REAL published wheel. Epic #442, #451.
 * `iniconfig` stands in for a bundle_cli wheel: piot's own fixtures publish
 * to TestPyPI, whose download host this repo's egress proxy blocks with a
 * 403 CONNECT denial. The command only looks for `<stage_to>/<bin>`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const PKG = 'iniconfig';

let pkg: string;

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

/** A real pure wheel URL from PyPI. */
async function liveWheelUrl(): Promise<string> {
  const res = await fetch(`https://pypi.org/pypi/${PKG}/json`, {
    headers: { 'user-agent': 'piot-e2e-verify-bundle-cli' },
  });
  const body = (await res.json()) as { urls: { filename: string; url: string }[] };
  const whl = body.urls.find((u) => u.filename.endsWith('.whl'));
  if (!whl) {throw new Error(`no wheel published for ${PKG}`);}
  return whl.url;
}

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-verify-bundle-cli-e2e-'));
});

afterEach(() => {
  rmSync(pkg, { recursive: true, force: true });
});

describe('piot verify bundle-cli against a real published wheel (#451)', () => {
  it('confirms the built CLI locates a known nested entry in the wheel', async () => {
    const url = await liveWheelUrl();

    // maturin writes the wheel into <path>/dist — mirror that layout.
    const dist = join(pkg, 'dist');
    mkdirSync(dist, { recursive: true });
    execFileSync('curl', ['-fsSL', '-A', 'piot-e2e-verify-bundle-cli', '-o', join(dist, basename(url)), url]);

    const { code, stdout, stderr } = runCli([
      'verify', 'bundle-cli',
      '--path', pkg, '--stage-to', 'iniconfig', '--bin', '__init__.py',
      '--target', 'x86_64-unknown-linux-gnu',
    ]);

    expect(stdout, `output:\n${stdout}\n${stderr}`).toContain('ok bundle_cli: iniconfig/__init__.py present in');
    expect(code).toBe(0);
  });
});

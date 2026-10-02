/**
 * `verify-bundle-cli` through the ncc-bundled action (`dist-action/index.js`),
 * a separate build artifact from the CLI its sibling e2e exercises. #595.
 * `iniconfig` stands in for a bundle_cli wheel: piot's own publish to
 * TestPyPI, whose download host this repo's egress proxy blocks.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const ACTION = join(ROOT, 'dist-action', 'index.js');
const PKG = 'iniconfig';

let pkg: string;

/** Run the bundled action with the `INPUT_*` env GitHub Actions would set. */
function runAction(inputs: Record<string, string>): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  for (const [k, v] of Object.entries(inputs)) {
    env[`INPUT_${k.toUpperCase()}`] = v;
  }
  try {
    const stdout = execFileSync('node', [ACTION], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
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
    headers: { 'user-agent': 'piot-e2e-action-verify-bundle-cli' },
  });
  const body = (await res.json()) as { urls: { filename: string; url: string }[] };
  const whl = body.urls.find((u) => u.filename.endsWith('.whl'));
  if (!whl) {throw new Error(`no wheel published for ${PKG}`);}
  return whl.url;
}

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-action-bundle-cli-e2e-'));
});

afterEach(() => {
  rmSync(pkg, { recursive: true, force: true });
});

describe('bundled action, command: verify-bundle-cli, real wheel (#595)', () => {
  it('locates the staged entry and exits 0', async () => {
    const url = await liveWheelUrl();

    // maturin writes the wheel into <path>/dist — mirror that layout.
    const dist = join(pkg, 'dist');
    mkdirSync(dist, { recursive: true });
    execFileSync('curl', [
      '-fsSL', '-A', 'piot-e2e-action-verify-bundle-cli',
      '-o', join(dist, basename(url)), url,
    ]);

    const { code, stdout, stderr } = runAction({
      command: 'verify-bundle-cli',
      working_directory: pkg,
      stage_to: 'iniconfig',
      bin: '__init__.py',
      target: 'x86_64-unknown-linux-gnu',
    });

    expect(stdout, `output:\n${stdout}\n${stderr}`)
      .toContain('ok bundle_cli: iniconfig/__init__.py present in');
    expect(code).toBe(0);
  });

  it('exits non-zero when the staged entry is absent', async () => {
    const url = await liveWheelUrl();
    const dist = join(pkg, 'dist');
    mkdirSync(dist, { recursive: true });
    execFileSync('curl', [
      '-fsSL', '-A', 'piot-e2e-action-verify-bundle-cli',
      '-o', join(dist, basename(url)), url,
    ]);

    const { code, stdout } = runAction({
      command: 'verify-bundle-cli',
      working_directory: pkg,
      stage_to: 'nowhere/_binary',
      bin: 'absent',
      target: 'x86_64-unknown-linux-gnu',
    });

    expect(stdout).toContain('missing bundle_cli binary at nowhere/_binary/absent');
    expect(code).toBe(1);
  });
});

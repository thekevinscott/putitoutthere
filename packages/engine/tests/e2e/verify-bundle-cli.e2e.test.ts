/**
 * `piot verify bundle-cli` against a REAL published wheel — the e2e twin of
 * `tests/integration/verify-bundle-cli.integration.test.ts`. Epic #442, #451.
 *
 * Where the integration test drives the engine in-process against `.whl`
 * files it builds locally, this one **shells out to the built CLI**
 * (`node dist/cli-bin.js verify bundle-cli …`) against a **real, build-tool-
 * produced** wheel downloaded from PyPI. This is the tier that proves the
 * built CLI's pure-Node zip reader locates a known nested entry inside a
 * genuine (deflate-compressed) wheel end-to-end — a mock, or a locally
 * hand-built zip, only assumes that shape.
 *
 * Fixture choice: the shape `verify bundle-cli` targets — a maturin wheel
 * bundling a cross-compiled binary at `<stage_to>/<bin>` — has no publicly
 * downloadable exemplar on a real index (piot's own bundle_cli fixtures
 * publish to TestPyPI, whose download host this repo's policy egress proxy
 * blocks with a 403 CONNECT denial). But the command's job is purely "does
 * the wheel contain an entry ending `<stage_to>/<bin>`", so any real wheel
 * with a known nested entry exercises it. `iniconfig` is a tiny, ubiquitous
 * pure-`py3-none-any` wheel on real PyPI (files.pythonhosted.org is
 * allowlisted); its `iniconfig/__init__.py` entry stands in for the staged
 * binary — `--stage-to iniconfig --bin __init__.py` asserts the CLI finds
 * `iniconfig/__init__.py` in the real deflate wheel.
 *
 * Red before the feature: `verify bundle-cli` is an unrecognized subcommand,
 * so no `ok bundle_cli:` line is emitted and the CLI exits non-zero.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
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

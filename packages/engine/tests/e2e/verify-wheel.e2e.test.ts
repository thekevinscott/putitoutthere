/**
 * `piot verify wheel` against a REAL published wheel — the e2e twin of
 * `tests/integration/verify-wheel.integration.test.ts`. Epic #442, #450.
 *
 * Where the integration test drives the engine in-process against wheels it
 * builds locally, this one **shells out to the built CLI**
 * (`node dist/cli-bin.js verify wheel …`) against a **real, build-tool-
 * produced** wheel downloaded from PyPI. This is the tier that proves the
 * engine's pure-Node zip reader inspects a genuine (deflate-compressed)
 * wheel's `dist-info/METADATA` — a mock, or a locally hand-built zip, only
 * assumes that shape.
 *
 * Package choice: piot's own python fixtures publish to TestPyPI, whose
 * download host is not reachable through this repo's policy egress proxy
 * (a 403 CONNECT denial), so it can't run locally. `iniconfig` is a tiny,
 * ubiquitous, pure `py3-none-any` wheel on real PyPI (files.pythonhosted.org
 * is allowlisted), reachable both locally and on CI runners; the version is
 * read from the same PyPI response, so there is nothing to hard-code.
 *
 * Red before the feature: `verify wheel` is an unrecognized subcommand, so
 * no `ok wheel:` line is emitted and the CLI exits non-zero.
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

/** The fixture's current version + a pure wheel URL from TestPyPI. */
async function liveWheel(): Promise<{ version: string; url: string }> {
  const res = await fetch(`https://pypi.org/pypi/${PKG}/json`, {
    headers: { 'user-agent': 'piot-e2e-verify-wheel' },
  });
  const body = (await res.json()) as {
    info: { version: string };
    urls: { filename: string; url: string }[];
  };
  const whl = body.urls.find((u) => u.filename.endsWith('.whl'));
  if (!whl) throw new Error(`no wheel published for ${PKG}@${body.info.version}`);
  return { version: body.info.version, url: whl.url };
}

beforeEach(() => {
  pkg = mkdtempSync(join(tmpdir(), 'piot-verify-wheel-e2e-'));
});

afterEach(() => {
  rmSync(pkg, { recursive: true, force: true });
});

describe('piot verify wheel against a real published wheel (#450)', () => {
  it('confirms the wheel METADATA Version matches the planned version', async () => {
    const { version, url } = await liveWheel();

    // maturin/hatch write the wheel into <path>/dist — mirror that layout.
    const dist = join(pkg, 'dist');
    mkdirSync(dist, { recursive: true });
    execFileSync('curl', ['-fsSL', '-A', 'piot-e2e-verify-wheel', '-o', join(dist, basename(url)), url]);

    const { code, stdout, stderr } = runCli([
      'verify', 'wheel', '--path', pkg, '--version', version, '--target', 'x86_64-unknown-linux-gnu',
    ]);

    expect(stdout, `output:\n${stdout}\n${stderr}`).toContain(`METADATA Version=${version}`);
    expect(code).toBe(0);
  });
});

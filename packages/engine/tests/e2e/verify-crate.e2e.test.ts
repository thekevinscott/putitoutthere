/**
 * `piot verify crate` against a REAL published `.crate` — the e2e twin of
 * `tests/integration/verify-crate.integration.test.ts`. Epic #442, #449.
 *
 * Where the integration test drives the engine in-process against `.crate`
 * files it builds locally, this one **shells out to the built CLI**
 * (`node dist/cli-bin.js verify crate …`) against the **real, cargo-produced
 * `.crate`** for piot's own stable fixture crate `piot-fixture-zzz-poly-rust`,
 * downloaded from crates.io and dropped under a temp registry root exactly
 * as `cargo-http-registry` lays it out on disk. This is the tier that proves
 * the real `tar` pipeline inspects a genuine cargo `.crate` — whose layout
 * (`<name>-<version>/src/…`) a hand-rolled tarball only assumes.
 *
 * Red before the feature: `verify crate` is an unrecognized subcommand, so
 * no `ok:` line is emitted and the CLI exits non-zero.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const CRATE = 'piot-fixture-zzz-poly-rust';

let regRoot: string;

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

/** The crate's current newest published version on crates.io. */
async function liveVersion(): Promise<string> {
  const res = await fetch(`https://crates.io/api/v1/crates/${CRATE}`, {
    headers: { 'user-agent': 'piot-e2e-verify-crate' },
  });
  const body = (await res.json()) as { crate: { newest_version: string } };
  return body.crate.newest_version;
}

beforeEach(() => {
  regRoot = mkdtempSync(join(tmpdir(), 'piot-verify-crate-e2e-'));
});

afterEach(() => {
  rmSync(regRoot, { recursive: true, force: true });
});

describe('piot verify crate against a real published .crate (#449)', () => {
  it('confirms the published .crate ships its source tree', async () => {
    const version = await liveVersion();

    // Drop the real .crate under the registry root the way
    // cargo-http-registry stores it: <root>/<name>-<version>.crate.
    const dest = join(regRoot, 'crates', CRATE);
    mkdirSync(dest, { recursive: true });
    // crates.io rejects downloads without a descriptive User-Agent (403).
    execFileSync('curl', [
      '-fsSL', '-A', 'piot-e2e-verify-crate', '-o', join(dest, `${CRATE}-${version}.crate`),
      `https://crates.io/api/v1/crates/${CRATE}/${version}/download`,
    ]);

    const matrix = JSON.stringify([{ name: CRATE, kind: 'crates', version }]);
    const { code, stdout, stderr } = runCli([
      'verify', 'crate', '--matrix', matrix, '--registry-root', regRoot,
    ]);

    expect(stdout, `output:\n${stdout}\n${stderr}`).toContain('contains src/lib.rs or src/main.rs');
    expect(code).toBe(0);
  });
});

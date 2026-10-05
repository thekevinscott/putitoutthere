/**
 * `verify crate` against the REAL cargo-produced `.crate` for piot's fixture
 * crate, downloaded from crates.io and dropped under a temp registry root
 * exactly as `cargo-http-registry` lays it out. Epic #442, #449.
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

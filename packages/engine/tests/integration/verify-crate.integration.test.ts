/**
 * `piot verify crate` — published `.crate` tarball-contents verification
 * (integration). Epic #442, sub-issue #449.
 *
 * Extraction of the inline "Verify published .crate tarballs honor expected
 * files" bash block in `.github/workflows/e2e-fixture-job.yml` (#334) into
 * one tested engine subcommand. Where the npm sibling (#443) downloads a
 * tarball over HTTP, the crates path reads `.crate` files straight off the
 * `cargo-http-registry` disk root the engine just published to — same host,
 * same job, no fetch. So this command takes a `--registry-root <dir>` and
 * `find`s `<name>-<version>.crate` under it, extracts with the REAL `tar`,
 * and asserts the fixture source tree (`src/lib.rs` or `src/main.rs`)
 * surfaces.
 *
 * This tier drives the CLI in-process (`run([...])`) against real `.crate`
 * files it builds on disk with the real `tar` — deterministic, no network.
 * The e2e twin (`tests/e2e/verify-crate.e2e.test.ts`) shells out to the
 * built CLI against the real published fixture crate downloaded from
 * crates.io.
 *
 * Contract preserved verbatim from the bash: same row selection, same
 * `::error::` strings, same `ok:` line, same exit code.
 *
 * Red before the command exists: `verify crate` is an unrecognized
 * subcommand, so `run` errors and no `ok:` line is emitted.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

let regRoot: string;
const out: string[] = [];

/**
 * Write a real `.crate` (gzipped tar, cargo's `<name>-<version>/…` prefix)
 * into a nested subdir of the registry root, so the command's recursive
 * find is exercised. `files` maps in-crate relative paths to bodies.
 */
function writeCrate(name: string, version: string, files: Record<string, string>): void {
  const stage = mkdtempSync(join(tmpdir(), 'piot-crate-stage-'));
  const prefix = `${name}-${version}`;
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(stage, prefix, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  const dest = join(regRoot, 'crates', name);
  mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-czf', join(dest, `${prefix}.crate`), '-C', stage, prefix]);
  rmSync(stage, { recursive: true, force: true });
}

beforeEach(() => {
  regRoot = mkdtempSync(join(tmpdir(), 'piot-alt-registry-'));
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
  rmSync(regRoot, { recursive: true, force: true });
});

function cratesRow(over: object = {}): object {
  return { name: 'demo-crate', kind: 'crates', version: '1.0.0', ...over };
}

async function runVerify(matrix: object[]): Promise<number> {
  return run([
    'node', 'piot', 'verify', 'crate',
    '--matrix', JSON.stringify(matrix),
    '--registry-root', regRoot,
  ]);
}

describe('piot verify crate: .crate contents (#449)', () => {
  it('passes when the published .crate contains src/lib.rs', async () => {
    writeCrate('demo-crate', '1.0.0', {
      'Cargo.toml': '[package]\nname = "demo-crate"\n',
      'src/lib.rs': 'pub fn x() {}\n',
    });

    const code = await runVerify([cratesRow()]);

    expect(out.join('')).toContain('ok:');
    expect(out.join('')).toContain('contains src/lib.rs or src/main.rs');
    expect(code).toBe(0);
  });

  it('passes when the .crate is a binary crate shipping src/main.rs', async () => {
    writeCrate('demo-crate', '1.0.0', {
      'Cargo.toml': '[package]\nname = "demo-crate"\n',
      'src/main.rs': 'fn main() {}\n',
    });

    const code = await runVerify([cratesRow()]);

    expect(out.join('')).toContain('ok:');
    expect(code).toBe(0);
  });

  it('ignores non-crates rows', async () => {
    writeCrate('demo-crate', '1.0.0', { 'src/lib.rs': 'pub fn x() {}\n' });

    const code = await runVerify([
      cratesRow(),
      { name: '@scope/pkg', kind: 'npm', version: '1.0.0' },
    ]);

    expect(code).toBe(0);
  });

  it('fails when no .crate file is present under the registry root', async () => {
    // Nothing written → the publish silently no-op'd, the diagnostic bug
    // this gate exists to catch.
    const code = await runVerify([cratesRow()]);

    const text = out.join('');
    expect(text).toContain('[demo-crate@1.0.0] no .crate file found (or empty)');
    expect(text).toContain(regRoot);
    expect(code).toBe(1);
  });

  it('fails when the .crate is empty', async () => {
    const dest = join(regRoot, 'crates', 'demo-crate');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'demo-crate-1.0.0.crate'), '');

    const code = await runVerify([cratesRow()]);

    expect(out.join('')).toContain('no .crate file found (or empty)');
    expect(code).toBe(1);
  });

  it('fails when the .crate ships neither src/lib.rs nor src/main.rs', async () => {
    writeCrate('demo-crate', '1.0.0', {
      'Cargo.toml': '[package]\nname = "demo-crate"\n',
      'README.md': '# demo\n',
    });

    const code = await runVerify([cratesRow()]);

    const text = out.join('');
    expect(text).toContain('.crate tarball missing src/lib.rs and src/main.rs');
    expect(text).toContain('Tarball contents:');
    expect(code).toBe(1);
  });
});

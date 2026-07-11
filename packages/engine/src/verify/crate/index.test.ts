/**
 * `verifyCrate` — the `.crate` contents-verification engine command (#449).
 * Colocated unit tests over real `.crate` tarballs built on disk with the
 * real `tar`, exercising every branch: source present (lib.rs / main.rs),
 * missing crate, empty crate, missing source, and the no-rows short-circuit.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyCrate } from './index.js';

let regRoot: string;
const out: string[] = [];

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
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(regRoot, { recursive: true, force: true });
});

const matrix = (rows: object[]): string => JSON.stringify(rows);
const row = (over: object = {}): object => ({ name: 'demo-crate', kind: 'crates', version: '1.0.0', ...over });

describe('verifyCrate', () => {
  it('returns 0 with a friendly line when there are no crates rows', () => {
    const code = verifyCrate({ matrix: matrix([{ name: 'p', kind: 'npm', version: '1.0.0' }]), registryRoot: regRoot });
    expect(out.join('')).toContain('No crates rows; nothing to verify.');
    expect(code).toBe(0);
  });

  it('passes on a library crate shipping src/lib.rs', () => {
    writeCrate('demo-crate', '1.0.0', { 'Cargo.toml': '[package]\n', 'src/lib.rs': 'pub fn x() {}\n' });
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: regRoot });
    expect(out.join('')).toContain('contains src/lib.rs or src/main.rs');
    expect(code).toBe(0);
  });

  it('passes on a binary crate shipping src/main.rs', () => {
    writeCrate('demo-crate', '1.0.0', { 'Cargo.toml': '[package]\n', 'src/main.rs': 'fn main() {}\n' });
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: regRoot });
    expect(out.join('')).toContain('ok:');
    expect(code).toBe(0);
  });

  it('fails when no .crate is present under the registry root', () => {
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: regRoot });
    const text = out.join('');
    expect(text).toContain('[demo-crate@1.0.0] no .crate file found (or empty)');
    expect(text).toContain(regRoot);
    expect(code).toBe(1);
  });

  it('fails when the .crate is empty', () => {
    const dest = join(regRoot, 'crates', 'demo-crate');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'demo-crate-1.0.0.crate'), '');
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: regRoot });
    expect(out.join('')).toContain('no .crate file found (or empty)');
    expect(code).toBe(1);
  });

  it('fails and lists contents when neither src/lib.rs nor src/main.rs is present', () => {
    writeCrate('demo-crate', '1.0.0', { 'Cargo.toml': '[package]\n', 'README.md': '# demo\n' });
    const code = verifyCrate({ matrix: matrix([row()]), registryRoot: regRoot });
    const text = out.join('');
    expect(text).toContain('.crate tarball missing src/lib.rs and src/main.rs');
    expect(text).toContain('Tarball contents:');
    expect(code).toBe(1);
  });

  it('aggregates: one good, one bad → exit 1, both reported', () => {
    writeCrate('good-crate', '1.0.0', { 'src/lib.rs': 'pub fn x() {}\n' });
    writeCrate('bad-crate', '2.0.0', { 'README.md': '# no source\n' });
    const code = verifyCrate({
      matrix: matrix([
        { name: 'good-crate', kind: 'crates', version: '1.0.0' },
        { name: 'bad-crate', kind: 'crates', version: '2.0.0' },
      ]),
      registryRoot: regRoot,
    });
    const text = out.join('');
    expect(text).toContain('ok:');
    expect(text).toContain('[bad-crate@2.0.0] .crate tarball missing');
    expect(code).toBe(1);
  });
});

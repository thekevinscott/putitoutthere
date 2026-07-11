/**
 * `extractCrate` (#449): unpacks a gzipped tar (`.crate`) into a fresh
 * temp dir. Exercised for real against a `tar`-built archive — the same
 * `tar -xzf` the function shells out to.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractCrate } from './extract-crate.js';

let scratch: string;
const cleanup: string[] = [];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'piot-extract-crate-src-'));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  while (cleanup.length) {
    rmSync(cleanup.pop()!, { recursive: true, force: true });
  }
});

/** Build a `.crate` (gzipped tar) whose top-level dir holds `files`. */
function makeCrate(root: string, files: Record<string, string>): string {
  const staging = join(scratch, 'staging');
  mkdirSync(join(staging, root), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(staging, root, name), content);
  }
  const cratePath = join(scratch, `${root}.crate`);
  execFileSync('tar', ['-czf', cratePath, '-C', staging, root]);
  return cratePath;
}

/** Extract and register the result dir for cleanup. */
function extract(cratePath: string): string {
  const dir = extractCrate(cratePath);
  cleanup.push(dir);
  return dir;
}

describe('extractCrate', () => {
  it('extracts the archive contents into a new directory', () => {
    const cratePath = makeCrate('demo-1.0.0', {
      'Cargo.toml': 'name = "demo"\n',
      'lib.rs': 'pub fn hi() {}\n',
    });

    const dir = extract(cratePath);

    expect(readFileSync(join(dir, 'demo-1.0.0', 'Cargo.toml'), 'utf8')).toBe('name = "demo"\n');
    expect(readFileSync(join(dir, 'demo-1.0.0', 'lib.rs'), 'utf8')).toBe('pub fn hi() {}\n');
  });

  it('returns a fresh directory distinct on each call', () => {
    const cratePath = makeCrate('demo-2.0.0', { 'Cargo.toml': '\n' });

    const a = extract(cratePath);
    const b = extract(cratePath);

    expect(a).not.toBe(b);
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
  });
});

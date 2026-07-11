/**
 * `hasCrateSource` — src/lib.rs || src/main.rs presence in an extracted
 * crate tree (#449).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hasCrateSource } from './has-crate-source.js';

let dir: string;

function put(rel: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, '');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piot-crate-src-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('hasCrateSource', () => {
  it('is true when the tree has <prefix>/src/lib.rs', () => {
    put('demo-1.0.0/Cargo.toml');
    put('demo-1.0.0/src/lib.rs');
    expect(hasCrateSource(dir)).toBe(true);
  });

  it('is true when the tree has <prefix>/src/main.rs', () => {
    put('demo-1.0.0/src/main.rs');
    expect(hasCrateSource(dir)).toBe(true);
  });

  it('is false when only non-source files are present', () => {
    put('demo-1.0.0/Cargo.toml');
    put('demo-1.0.0/README.md');
    expect(hasCrateSource(dir)).toBe(false);
  });

  it('does not match a stray main.rs outside a src/ dir', () => {
    put('demo-1.0.0/bin/main.rs');
    expect(hasCrateSource(dir)).toBe(false);
  });
});

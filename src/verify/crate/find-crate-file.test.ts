/**
 * `findCrateFile` — recursive, non-empty `.crate` lookup (#449).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findCrateFile } from './find-crate-file.js';

let root: string;

function put(rel: string, body = 'data'): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piot-find-crate-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findCrateFile', () => {
  it('finds a nested, non-empty .crate by name-version', () => {
    const abs = put('crates/demo/demo-1.0.0.crate');
    expect(findCrateFile(root, 'demo', '1.0.0')).toBe(abs);
  });

  it('returns null when the matching .crate is empty', () => {
    put('crates/demo/demo-1.0.0.crate', '');
    expect(findCrateFile(root, 'demo', '1.0.0')).toBeNull();
  });

  it('returns null when no .crate matches the name-version', () => {
    put('crates/demo/demo-9.9.9.crate');
    expect(findCrateFile(root, 'demo', '1.0.0')).toBeNull();
  });

  it('returns null for a missing registry root', () => {
    expect(findCrateFile(join(root, 'does-not-exist'), 'demo', '1.0.0')).toBeNull();
  });
});

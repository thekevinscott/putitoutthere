/**
 * `findDistFile` — first `<ext>` file directly under a dir (#450).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findDistFile } from './find-dist-file.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piot-dist-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('findDistFile', () => {
  it('finds a .whl', () => {
    writeFileSync(join(dir, 'demo-1.0.0-py3-none-any.whl'), 'x');
    expect(basename(findDistFile(dir, '.whl')!)).toBe('demo-1.0.0-py3-none-any.whl');
  });

  it('finds a .tar.gz', () => {
    writeFileSync(join(dir, 'demo-1.0.0.tar.gz'), 'x');
    expect(basename(findDistFile(dir, '.tar.gz')!)).toBe('demo-1.0.0.tar.gz');
  });

  it('returns null when no file matches the extension', () => {
    writeFileSync(join(dir, 'demo-1.0.0.tar.gz'), 'x');
    expect(findDistFile(dir, '.whl')).toBeNull();
  });

  it('returns null for a missing directory', () => {
    expect(findDistFile(join(dir, 'nope'), '.whl')).toBeNull();
  });

  it('ignores a matching directory (files only)', () => {
    mkdirSync(join(dir, 'weird.whl'));
    expect(findDistFile(dir, '.whl')).toBeNull();
  });
});

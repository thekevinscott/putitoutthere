import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { localDirState } from './local-dir-state.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lds-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('localDirState', () => {
  it('reports present + file count + listing when the dir exists locally', () => {
    const d = join(dir, 'dist');
    mkdirSync(d);
    writeFileSync(join(d, 'index.js'), '');

    const state = localDirState(d);
    expect(state).toBe(`local ${d}: present, 1 file(s) — ${join(d, 'index.js')} `);
  });

  it('reports missing when the path does not exist', () => {
    expect(localDirState(join(dir, 'gone'))).toBe(`local ${join(dir, 'gone')}: missing`);
  });

  it('reports missing when the path exists but is a file, not a directory', () => {
    const f = join(dir, 'dist');
    writeFileSync(f, '');
    expect(localDirState(f)).toBe(`local ${f}: missing`);
  });
});

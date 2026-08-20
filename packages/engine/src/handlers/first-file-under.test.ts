import { readdir, stat } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { firstFileUnder } from './first-file-under.js';

// Bare automock (no factory): `stat` / `readdir` are the unit's only side
// channel, so isolate them and drive the tree through their returns. Real
// walking over a staged artifact tree is covered at the integration and e2e
// tiers (tests/**/npm-platform-nested-binary.*).
vi.mock('node:fs/promises');

const statMock = vi.mocked(stat);
const readdirMock = vi.mocked(readdir);

// Separator-agnostic: the source joins with node:path (real, unmocked), so on
// Windows the recursion keys arrive back-slashed. Normalize before comparing.
const norm = (p: unknown): string => String(p).replace(/\\/g, '/');

/** Seed a tree: keys are directories, values their entry names. Any path not
 *  named as a directory key is a file. */
function seed(tree: Record<string, string[]>): void {
  statMock.mockImplementation(((p: string) =>
    Promise.resolve({ isDirectory: () => norm(p) in tree } as never)) as unknown as typeof stat);
  readdirMock.mockImplementation(((p: string) =>
    Promise.resolve(tree[norm(p)] ?? [])) as unknown as typeof readdir);
}

beforeEach(() => {
  statMock.mockReset();
  readdirMock.mockReset();
});

describe('firstFileUnder', () => {
  it('returns a top-level candidate that is already a file', async () => {
    seed({ '/stage': ['demo-cli'] });
    expect(await firstFileUnder('/stage', ['demo-cli'])).toBe('demo-cli');
  });

  it('descends into a directory and returns the posix path of the file inside', async () => {
    // The layout #626 is about: the binary staged under `bin/`.
    seed({ '/stage': ['bin'], '/stage/bin': ['demo-cli'] });
    expect(await firstFileUnder('/stage', ['bin'])).toBe('bin/demo-cli');
  });

  it('descends through more than one level of nesting', async () => {
    seed({
      '/stage': ['out'],
      '/stage/out': ['release'],
      '/stage/out/release': ['demo-cli'],
    });
    expect(await firstFileUnder('/stage', ['out'])).toBe('out/release/demo-cli');
  });

  it('moves on to the next candidate when a directory holds no file', async () => {
    // An empty (or all-empty-dirs) branch must not swallow the search: the
    // later candidate is the real payload.
    seed({ '/stage': ['empty', 'demo-cli'], '/stage/empty': [] });
    expect(await firstFileUnder('/stage', ['empty', 'demo-cli'])).toBe('demo-cli');
  });

  it('honours candidate order rather than readdir order', async () => {
    // Callers filter the candidate list (e.g. dropping `package.json`), so the
    // list they pass — not the directory listing — decides what wins.
    seed({ '/stage': ['package.json', 'demo-cli'] });
    expect(await firstFileUnder('/stage', ['demo-cli', 'package.json'])).toBe('demo-cli');
  });

  it('returns undefined when no candidate resolves to a file', async () => {
    seed({ '/stage': ['bin'], '/stage/bin': [] });
    expect(await firstFileUnder('/stage', ['bin'])).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', async () => {
    seed({ '/stage': [] });
    expect(await firstFileUnder('/stage', [])).toBeUndefined();
  });
});

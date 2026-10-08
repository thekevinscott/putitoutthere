import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scope } from '../../src/utils/scope/scope.js';

const tree: Record<string, string> = {
  'AGENTS.md': '@notes/design.md\n@notes/loop-a.md\n',
  'notes/design.md': 'no refs here\n',
  'notes/loop-a.md': '@notes/loop-b.md\n',
  'notes/loop-b.md': '@notes/loop-a.md\n@AGENTS.md\n',
  'packages/engine/AGENTS.md': '@notes/engine.md\n@notes/deleted.md\n',
  'notes/engine.md': '',
  'README.md': '',
};

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scope-'));
  for (const [path, body] of Object.entries(tree)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const deps = {
  readFile: async (path: string) => {
    try {
      return await readFile(join(root, path), 'utf8');
    } catch {
      return undefined;
    }
  },
  extractRefs: (_path: string, content: string) =>
    content.split('\n').filter((l) => l.startsWith('@')).map((l) => l.slice(1)),
};

const seeds = ['AGENTS.md', 'packages/engine/AGENTS.md'];
const toUnit = (seed: string) => ({ file: seed });

describe('scope over a real file tree', () => {
  it('selects a seed not in the changed set through a ref cycle', async () => {
    expect(await scope({ seeds, changed: ['notes/loop-b.md'], toUnit }, deps)).toEqual([{ file: 'AGENTS.md' }]);
  });

  it('selects each seed whose closure was touched, in seed order', async () => {
    expect(await scope({ seeds, changed: ['notes/engine.md', 'notes/design.md'], toUnit }, deps)).toEqual([
      { file: 'AGENTS.md' },
      { file: 'packages/engine/AGENTS.md' },
    ]);
  });

  it('selects a seed whose ref no longer exists on disk', async () => {
    expect(await scope({ seeds, changed: ['notes/deleted.md'], toUnit }, deps)).toEqual([
      { file: 'packages/engine/AGENTS.md' },
    ]);
  });

  it('is [] when only unreferenced files changed', async () => {
    expect(await scope({ seeds, changed: ['README.md'], toUnit }, deps)).toEqual([]);
  });
});

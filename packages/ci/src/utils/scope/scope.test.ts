import { describe, expect, it } from 'vitest';

import { scope } from './scope.js';

const files: Record<string, string> = {
  'AGENTS.md': '@notes/design.md',
  'notes/design.md': '',
  'packages/engine/AGENTS.md': '@shared.md',
  'shared.md': '@packages/engine/AGENTS.md',
};

const deps = {
  readFile: (path: string) => Promise.resolve(files[path]),
  extractRefs: (_path: string, content: string) =>
    content.split('\n').filter((l) => l.startsWith('@')).map((l) => l.slice(1)),
};

const toUnit = (seed: string) => ({ file: seed });
const seeds = ['AGENTS.md', 'packages/engine/AGENTS.md'];

describe('scope', () => {
  it('is [] when nothing changed', async () => {
    expect(await scope({ seeds, changed: [], toUnit }, deps)).toEqual([]);
  });

  it('is [] when no change touches any closure', async () => {
    expect(await scope({ seeds, changed: ['README.md'], toUnit }, deps)).toEqual([]);
  });

  it('includes a seed that changed itself', async () => {
    expect(await scope({ seeds, changed: ['AGENTS.md'], toUnit }, deps)).toEqual([{ file: 'AGENTS.md' }]);
  });

  it('includes a seed not in the changed set when a ref changed', async () => {
    expect(await scope({ seeds, changed: ['notes/design.md'], toUnit }, deps)).toEqual([{ file: 'AGENTS.md' }]);
  });

  it('follows refs through a cycle', async () => {
    expect(await scope({ seeds, changed: ['shared.md'], toUnit }, deps)).toEqual([
      { file: 'packages/engine/AGENTS.md' },
    ]);
  });

  it('emits units in seed order', async () => {
    expect(await scope({ seeds, changed: ['shared.md', 'notes/design.md'], toUnit }, deps)).toEqual([
      { file: 'AGENTS.md' },
      { file: 'packages/engine/AGENTS.md' },
    ]);
  });

  it('emits a unit once when several seeds map to it', async () => {
    const r = await scope({ seeds, changed: ['AGENTS.md', 'shared.md'], toUnit: () => ({ package: 'root' }) }, deps);
    expect(r).toEqual([{ package: 'root' }]);
  });

  it('serialises to the testing-conventions#696 contract', async () => {
    expect(JSON.stringify(await scope({ seeds, changed: [], toUnit }, deps))).toBe('[]');
    expect(JSON.stringify(await scope({ seeds, changed: ['AGENTS.md'], toUnit }, deps))).toBe('[{"file":"AGENTS.md"}]');
  });
});

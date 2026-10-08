import { describe, expect, it } from 'vitest';

import { closure } from './closure.js';

const graph: Record<string, readonly string[]> = {
  'a.md': ['b.md', 'c.md'],
  'b.md': ['d.md'],
  'c.md': ['d.md'],
  'd.md': [],
  'x.md': ['x.md', 'y.md'],
  'y.md': ['x.md'],
};

function deps(files: Record<string, readonly string[]>) {
  const reads: string[] = [];
  return {
    reads,
    readFile: (path: string) => {
      reads.push(path);
      const refs = files[path];
      return Promise.resolve(refs === undefined ? undefined : refs.join('\n'));
    },
    extractRefs: (_path: string, content: string) => content.split('\n').filter((l) => l !== ''),
  };
}

describe('closure', () => {
  it('is empty for no seeds', async () => {
    expect(await closure([], deps(graph))).toEqual(new Set());
  });

  it('includes the seed and every transitive ref', async () => {
    expect(await closure(['a.md'], deps(graph))).toEqual(new Set(['a.md', 'b.md', 'c.md', 'd.md']));
  });

  it('terminates on cycles and self-refs, reading each file once', async () => {
    const d = deps(graph);
    expect(await closure(['x.md'], d)).toEqual(new Set(['x.md', 'y.md']));
    expect([...d.reads].sort()).toEqual(['x.md', 'y.md']);
  });

  it('reads a shared ref once across diamond paths', async () => {
    const d = deps(graph);
    await closure(['a.md'], d);
    expect(d.reads.filter((p) => p === 'd.md')).toEqual(['d.md']);
  });

  it('unions the closures of several seeds', async () => {
    expect(await closure(['b.md', 'y.md'], deps(graph))).toEqual(new Set(['b.md', 'd.md', 'x.md', 'y.md']));
  });

  it('keeps an unreadable ref in the closure without expanding it', async () => {
    const d = deps({ 'a.md': ['gone.md'] });
    expect(await closure(['a.md'], d)).toEqual(new Set(['a.md', 'gone.md']));
  });

  it('passes the referencing path to extractRefs', async () => {
    const seen: string[] = [];
    await closure(['dir/a.md'], {
      readFile: (p) => Promise.resolve(p === 'dir/a.md' ? 'b.md' : ''),
      extractRefs: (path, content) => {
        seen.push(path);
        return content === '' ? [] : [`dir/${content}`];
      },
    });
    expect(seen).toEqual(['dir/a.md', 'dir/b.md']);
  });
});

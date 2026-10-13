import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectEmbedded } from './collect-embedded.js';
import { readCargoManifest } from './read-cargo-manifest.js';
import { resolveDepDirs, type ResolvedDepDir } from './resolve-dep-dirs.js';

vi.mock('./read-cargo-manifest.js');
vi.mock('./resolve-dep-dirs.js');

const readMock = vi.mocked(readCargoManifest);
const resolveMock = vi.mocked(resolveDepDirs);

const dep = (dir: string): ResolvedDepDir => ({
  key: dir,
  dir,
  hasVersionReq: true,
  inheritsFromWorkspace: false,
});

function graph(edges: Record<string, string[]>): void {
  readMock.mockImplementation((dir) =>
    Promise.resolve(dir in edges ? { source: dir, parsed: dir } : null),
  );
  resolveMock.mockImplementation((parsed) => (edges[parsed as string] ?? []).map(dep));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('collectEmbedded', () => {
  it('walks path dependencies transitively, excluding the start', async () => {
    graph({ host: ['mid'], mid: ['core'], core: [] });
    expect([...(await collectEmbedded('host', null, null))]).toEqual(['mid', 'core']);
  });

  it('visits breadth-first and records each crate once', async () => {
    graph({ host: ['a', 'b'], a: ['c'], b: ['c', 'a'], c: [] });
    expect([...(await collectEmbedded('host', null, null))]).toEqual(['a', 'b', 'c']);
    expect(readMock.mock.calls.map((c) => c[0])).toEqual(['host', 'a', 'b', 'c']);
  });

  it('terminates on a cycle back to the start without collecting it', async () => {
    graph({ host: ['core'], core: ['host'] });
    expect([...(await collectEmbedded('host', null, null))]).toEqual(['core']);
  });

  it('collects a dependency with no readable manifest but does not walk it', async () => {
    graph({ host: ['gone'] });
    expect([...(await collectEmbedded('host', null, null))]).toEqual(['gone']);
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  it('passes the manifest dir and workspace context to resolveDepDirs', async () => {
    graph({ host: [] });
    const ws = { workspace: {} };
    await collectEmbedded('host', ws, '/r');
    expect(resolveMock).toHaveBeenCalledWith('host', 'host', ws, '/r');
  });
});

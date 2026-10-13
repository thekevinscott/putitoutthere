/**
 * Artifact completeness check tests (#13). Default-on guardrail that refuses
 * to publish any package whose matrix didn't fully produce.
 */

import { readdir, stat } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCompleteness, type MatrixRow } from './completeness.js';

vi.mock('node:fs/promises');

const readdirMock = vi.mocked(readdir);
const statMock = vi.mocked(stat);

/** Trailing segments (dir names + file entries) the virtual tree contains. */
let dirNames: string[] = [];
let entryNames: string[] = [];

// Plain string root — no `node:os`/`node:path` in the test. The subject
// joins this with each row's artifact_name via real `node:path`.
const root = 'artifacts';

/**
 * Stage a virtual artifacts tree from a map of artifact-directory name to the
 * file entries it contains. A name mapped to `[]` is a present-but-empty
 * directory; a name absent from the map does not exist. Membership is matched
 * by trailing path segment so no case hard-codes a separator.
 */
function stageDirs(dirs: Record<string, string[]>): void {
  dirNames = Object.keys(dirs);
  entryNames = Object.values(dirs).flat();
  readdirMock.mockImplementation((p) => {
    const name = dirNames.find((n) => String(p).endsWith(n));
    return Promise.resolve((name ? dirs[name] : []) as unknown as Awaited<ReturnType<typeof readdir>>);
  });
}

const enoent = (p: unknown): NodeJS.ErrnoException =>
  Object.assign(new Error(`ENOENT: ${String(p)}`), { code: 'ENOENT' });

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing staged — every directory is absent.
  dirNames = [];
  entryNames = [];
  readdirMock.mockResolvedValue([]);
  // `pathExists` (via stat) + listFiles' per-entry stat. A staged dir path
  // exists (resolves); a staged file entry resolves as a non-empty file;
  // anything else rejects with ENOENT so `pathExists` returns false.
  statMock.mockImplementation((p) => {
    const s = String(p);
    if (dirNames.some((n) => s.endsWith(n))) {
      return Promise.resolve({
        isDirectory: () => true, isFile: () => false, size: 0,
      } as unknown as Awaited<ReturnType<typeof stat>>);
    }
    if (entryNames.some((n) => s.endsWith(n))) {
      return Promise.resolve({
        isDirectory: () => false, isFile: () => true, size: 1,
      } as unknown as Awaited<ReturnType<typeof stat>>);
    }
    return Promise.reject(enoent(p));
  });
});

function row(over: Partial<MatrixRow>): MatrixRow {
  return {
    name: 'demo',
    kind: 'crates',
    version: '0.1.0',
    target: 'noarch',
    artifact_name: 'demo-crate',
    ...over,
  };
}

describe('checkCompleteness: single package, all present', () => {
  it('crates is always ok — pipeline never uploads .crate artifacts (#244)', async () => {
    // `cargo publish` builds + uploads from source on the registry
    // side. release.yml has no upload step for crates, so the publish
    // job never sees a `<name>-crate/` directory under artifacts/.
    // Skip the row instead of demanding a file that the pipeline
    // doesn't produce.
    const out = await checkCompleteness([row({})], root);
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('pypi sdist is ok when a .tar.gz is present', async () => {
    stageDirs({ 'demo-sdist': ['demo-0.1.0.tar.gz'] });
    const out = await checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('pypi wheel is ok when a .whl is present', async () => {
    stageDirs({
      'demo-wheel-x86_64-unknown-linux-gnu': [
        'demo-0.1.0-cp310-cp310-manylinux_2_17_x86_64.whl',
      ],
    });
    const out = await checkCompleteness(
      [
        row({
          kind: 'pypi',
          target: 'x86_64-unknown-linux-gnu',
          artifact_name: 'demo-wheel-x86_64-unknown-linux-gnu',
        }),
      ],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('npm platform package is ok when a .node or binary is present', async () => {
    stageDirs({ 'demo-npm-linux-x64-gnu': ['demo.node'] });
    const out = await checkCompleteness(
      [
        row({
          kind: 'npm',
          target: 'linux-x64-gnu',
          artifact_name: 'demo-npm-linux-x64-gnu',
        }),
      ],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('npm main is ok when a package.json is present', async () => {
    stageDirs({ 'demo-npm-main': ['package.json'] });
    const out = await checkCompleteness(
      [row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('npm vanilla (target=noarch) is ok when package.json is present', async () => {
    stageDirs({ 'demo-vanilla': ['package.json'] });
    const out = await checkCompleteness(
      [row({ kind: 'npm', target: 'noarch', artifact_name: 'demo-vanilla' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('recurses into subdirectories and skips empty / non-file entries', async () => {
    // Drive `listFiles` through every arm on a single OS — the branches a
    // per-platform run otherwise leaves uncovered: a nested directory
    // (recursion), a non-empty file (kept), a zero-byte file (skipped by the
    // `size > 0` guard), and a socket-like entry that is neither dir nor file
    // (the `isFile()` false fall-through). The package.json lives one level
    // deep, so a passing verdict proves the recursion actually descended.
    readdirMock.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('demo-npm-main')) {
        return Promise.resolve(['nested', 'empty.json', 'sock'] as unknown as Awaited<ReturnType<typeof readdir>>);
      }
      if (s.endsWith('nested')) {
        return Promise.resolve(['package.json'] as unknown as Awaited<ReturnType<typeof readdir>>);
      }
      return Promise.resolve([] as unknown as Awaited<ReturnType<typeof readdir>>);
    });
    statMock.mockImplementation((p) => {
      const s = String(p);
      const st = (over: Partial<{ isDirectory: boolean; isFile: boolean; size: number }>) =>
        Promise.resolve({
          isDirectory: () => over.isDirectory ?? false,
          isFile: () => over.isFile ?? false,
          size: over.size ?? 0,
        } as unknown as Awaited<ReturnType<typeof stat>>);
      if (s.endsWith('demo-npm-main') || s.endsWith('nested')) {return st({ isDirectory: true });}
      if (s.endsWith('package.json')) {return st({ isFile: true, size: 12 });}
      if (s.endsWith('empty.json')) {return st({ isFile: true, size: 0 });}
      return st({}); // 'sock': neither directory nor file
    });

    const out = await checkCompleteness(
      [row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('treats a directory holding only a zero-byte file and a non-file entry as empty', async () => {
    // Pins the *outcome* of the `size > 0` and `isFile()` filters, not just
    // their execution: a zero-byte file and a socket-like entry are both
    // dropped, so the directory lists no files and the row is reported empty.
    // (If either filter admitted its entry, a platform npm row would pass —
    // this asserts it does not.)
    readdirMock.mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('demo-plat')) {
        return Promise.resolve(['empty.node', 'sock'] as unknown as Awaited<ReturnType<typeof readdir>>);
      }
      return Promise.resolve([] as unknown as Awaited<ReturnType<typeof readdir>>);
    });
    statMock.mockImplementation((p) => {
      const s = String(p);
      const st = (over: Partial<{ isDirectory: boolean; isFile: boolean; size: number }>) =>
        Promise.resolve({
          isDirectory: () => over.isDirectory ?? false,
          isFile: () => over.isFile ?? false,
          size: over.size ?? 0,
        } as unknown as Awaited<ReturnType<typeof stat>>);
      if (s.endsWith('demo-plat')) {return st({ isDirectory: true });}
      if (s.endsWith('empty.node')) {return st({ isFile: true, size: 0 });} // zero-byte → dropped
      return st({ size: 5 }); // 'sock': neither dir nor file, non-zero size → dropped
    });

    const out = await checkCompleteness(
      [row({ kind: 'npm', target: 'linux-x64-gnu', artifact_name: 'demo-plat' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(false);
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/empty/i);
  });
});

describe('checkCompleteness: single package, issues', () => {
  it('reports a missing artifact directory as missing', async () => {
    const out = await checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    const pkg = out.get('demo');
    expect(pkg?.ok).toBe(false);
    expect(pkg?.missing[0]?.reason).toMatch(/missing/i);
  });

  it('reports an empty artifact directory as empty', async () => {
    stageDirs({ 'demo-sdist': [] });
    const out = await checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/empty/i);
  });

  it('reports a directory that cannot be read as unreadable', async () => {
    // pathExists passes (stat resolves the dir) but the subsequent listFiles
    // read fails — a permission fault or race between the existence probe and
    // the directory read. verifyRow's catch surfaces the reason instead of
    // letting the completeness pass crash.
    const dirName = 'demo-sdist';
    statMock.mockImplementation((p) => {
      if (String(p).endsWith(dirName)) {
        return Promise.resolve({
          isDirectory: () => true, isFile: () => false, size: 0,
        } as unknown as Awaited<ReturnType<typeof stat>>);
      }
      return Promise.reject(enoent(p));
    });
    readdirMock.mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );
    const out = await checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: dirName })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toBe(
      'cannot read demo-sdist/: EACCES: permission denied',
    );
  });

  it('stringifies a non-Error read failure', async () => {
    // A rejected read need not carry an Error — the catch's `String(err)` arm
    // renders whatever was thrown so the reason is never `[object Object]`-less
    // or a crash.
    const dirName = 'demo-sdist';
    statMock.mockImplementation((p) => {
      if (String(p).endsWith(dirName)) {
        return Promise.resolve({
          isDirectory: () => true, isFile: () => false, size: 0,
        } as unknown as Awaited<ReturnType<typeof stat>>);
      }
      return Promise.reject(enoent(p));
    });
    readdirMock.mockRejectedValue('raw string failure');
    const out = await checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: dirName })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toBe(
      'cannot read demo-sdist/: raw string failure',
    );
  });

  it('reports a pypi artifact with no .whl as wrong-shape', async () => {
    stageDirs({ 'demo-wheel-x86_64-unknown-linux-gnu': ['something.txt'] });
    const out = await checkCompleteness(
      [
        row({
          kind: 'pypi',
          target: 'x86_64-unknown-linux-gnu',
          artifact_name: 'demo-wheel-x86_64-unknown-linux-gnu',
        }),
      ],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/shape|whl/i);
  });

  it('reports a pypi sdist artifact with no .tar.gz as wrong-shape', async () => {
    stageDirs({ 'demo-sdist': ['junk.txt'] });
    const out = await checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/sdist|tar\.gz/i);
  });

  it('reports an npm main artifact with no package.json as wrong-shape', async () => {
    stageDirs({ 'demo-npm-main': ['junk.txt'] });
    const out = await checkCompleteness(
      [row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/package\.json/i);
  });
});

describe('checkCompleteness: multi-package', () => {
  it('reports per package independently', async () => {
    // a's sdist is present; b's artifact is missing entirely.
    stageDirs({ 'a-sdist': ['a-0.1.0.tar.gz'] });
    const matrix: MatrixRow[] = [
      row({ name: 'a', kind: 'pypi', target: 'sdist', artifact_name: 'a-sdist' }),
      row({ name: 'b', kind: 'pypi', target: 'sdist', artifact_name: 'b-sdist' }),
    ];
    const out = await checkCompleteness(matrix, root);
    expect(out.get('a')?.ok).toBe(true);
    expect(out.get('b')?.ok).toBe(false);
  });

  it('reports every missing target on a package, not just the first', async () => {
    // Package c expects 3 matrix rows; only one of its artifacts is present.
    stageDirs({ 'c-wheel-x86': ['w.whl'] });
    const matrix: MatrixRow[] = [
      row({
        name: 'c',
        kind: 'pypi',
        target: 'x86_64-unknown-linux-gnu',
        artifact_name: 'c-wheel-x86',
      }),
      row({
        name: 'c',
        kind: 'pypi',
        target: 'aarch64-unknown-linux-gnu',
        artifact_name: 'c-wheel-arm',
      }),
      row({ name: 'c', kind: 'pypi', target: 'sdist', artifact_name: 'c-sdist' }),
    ];
    const out = await checkCompleteness(matrix, root);
    const pkg = out.get('c');
    expect(pkg?.ok).toBe(false);
    expect(pkg?.missing.map((m) => m.row.target).sort()).toEqual([
      'aarch64-unknown-linux-gnu',
      'sdist',
    ]);
  });

  it('empty matrix returns empty result', async () => {
    const out = await checkCompleteness([], root);
    expect(out.size).toBe(0);
  });
});

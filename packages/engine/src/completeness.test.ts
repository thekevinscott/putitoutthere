/**
 * Artifact completeness check tests. Default-on guardrail that refuses
 * to publish any package whose matrix didn't fully produce.
 *
 * The `node:fs` boundary is automocked so each case isolates the
 * branching logic in `completeness.ts` — `existsSync` / `readdirSync` /
 * `statSync` are driven to stage an artifact directory (present /
 * absent / empty / wrong-shape) and the completeness verdict is
 * asserted, not real temp files. `node:path` stays real so the
 * subject's `join` still builds paths; the test never imports it and
 * feeds a plain string root, so assertions stay separator-agnostic and
 * hold on Windows as well as POSIX.
 *
 * Plan: §13.2.
 * Issue #13.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkCompleteness,
  expectedLayout,
  requireCompleteness,
  type MatrixRow,
} from './completeness.js';

vi.mock('node:fs');

const existsMock = vi.mocked(existsSync);
const readdirMock = vi.mocked(readdirSync);
const statMock = vi.mocked(statSync);

// Plain string root — no `node:os`/`node:path` in the test. The subject
// joins this with each row's artifact_name via real `node:path`.
const root = 'artifacts';

/**
 * Stage a virtual artifacts tree from a map of artifact-directory name
 * to the file entries it contains. A name mapped to `[]` is a present-
 * but-empty directory; a name absent from the map does not exist.
 *
 * Membership is matched by the trailing path segment so the test never
 * hard-codes a separator: the subject builds `join(root, artifact_name)`
 * and the dir path therefore ends with `artifact_name` on every OS.
 * Every listed entry is reported as a non-empty file (the completeness
 * check only recurses into subdirectories, which none of these cases
 * needs).
 */
function stageDirs(dirs: Record<string, string[]>): void {
  const names = Object.keys(dirs);
  existsMock.mockImplementation((p) =>
    names.some((name) => String(p).endsWith(name)),
  );
  readdirMock.mockImplementation((p) => {
    const name = names.find((n) => String(p).endsWith(n));
    return (name ? dirs[name] : []) as unknown as ReturnType<typeof readdirSync>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing staged — every directory is absent.
  existsMock.mockReturnValue(false);
  readdirMock.mockReturnValue([]);
  // Every staged entry is a non-empty file.
  statMock.mockImplementation(
    () =>
      ({
        isDirectory: () => false,
        isFile: () => true,
        size: 1,
      }) as unknown as ReturnType<typeof statSync>,
  );
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
  it('crates is always ok — pipeline never uploads .crate artifacts (#244)', () => {
    // `cargo publish` builds + uploads from source on the registry
    // side. release.yml has no upload step for crates, so the publish
    // job never sees a `<name>-crate/` directory under artifacts/.
    // Skip the row instead of demanding a file that the pipeline
    // doesn't produce.
    const out = checkCompleteness([row({})], root);
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('pypi sdist is ok when a .tar.gz is present', () => {
    stageDirs({ 'demo-sdist': ['demo-0.1.0.tar.gz'] });
    const out = checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('pypi wheel is ok when a .whl is present', () => {
    stageDirs({
      'demo-wheel-x86_64-unknown-linux-gnu': [
        'demo-0.1.0-cp310-cp310-manylinux_2_17_x86_64.whl',
      ],
    });
    const out = checkCompleteness(
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

  it('npm platform package is ok when a .node or binary is present', () => {
    stageDirs({ 'demo-npm-linux-x64-gnu': ['demo.node'] });
    const out = checkCompleteness(
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

  it('npm main is ok when a package.json is present', () => {
    stageDirs({ 'demo-npm-main': ['package.json'] });
    const out = checkCompleteness(
      [row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('npm vanilla (target=noarch) is ok when package.json is present', () => {
    stageDirs({ 'demo-vanilla': ['package.json'] });
    const out = checkCompleteness(
      [row({ kind: 'npm', target: 'noarch', artifact_name: 'demo-vanilla' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });
});

describe('checkCompleteness: single package, issues', () => {
  it('reports a missing artifact directory as missing', () => {
    const out = checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    const pkg = out.get('demo');
    expect(pkg?.ok).toBe(false);
    expect(pkg?.missing[0]?.reason).toMatch(/missing/i);
  });

  it('reports an empty artifact directory as empty', () => {
    stageDirs({ 'demo-sdist': [] });
    const out = checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/empty/i);
  });

  it('reports a pypi artifact with no .whl as wrong-shape', () => {
    stageDirs({ 'demo-wheel-x86_64-unknown-linux-gnu': ['something.txt'] });
    const out = checkCompleteness(
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

  it('reports a pypi sdist artifact with no .tar.gz as wrong-shape', () => {
    stageDirs({ 'demo-sdist': ['junk.txt'] });
    const out = checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/sdist|tar\.gz/i);
  });

  it('reports an npm main artifact with no package.json as wrong-shape', () => {
    stageDirs({ 'demo-npm-main': ['junk.txt'] });
    const out = checkCompleteness(
      [row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/package\.json/i);
  });
});

describe('checkCompleteness: multi-package', () => {
  it('reports per package independently', () => {
    // a's sdist is present; b's artifact is missing entirely.
    stageDirs({ 'a-sdist': ['a-0.1.0.tar.gz'] });
    const matrix: MatrixRow[] = [
      row({ name: 'a', kind: 'pypi', target: 'sdist', artifact_name: 'a-sdist' }),
      row({ name: 'b', kind: 'pypi', target: 'sdist', artifact_name: 'b-sdist' }),
    ];
    const out = checkCompleteness(matrix, root);
    expect(out.get('a')?.ok).toBe(true);
    expect(out.get('b')?.ok).toBe(false);
  });

  it('reports every missing target on a package, not just the first', () => {
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
    const out = checkCompleteness(matrix, root);
    const pkg = out.get('c');
    expect(pkg?.ok).toBe(false);
    expect(pkg?.missing.map((m) => m.row.target).sort()).toEqual([
      'aarch64-unknown-linux-gnu',
      'sdist',
    ]);
  });

  it('empty matrix returns empty result', () => {
    const out = checkCompleteness([], root);
    expect(out.size).toBe(0);
  });
});

describe('requireCompleteness', () => {
  it('returns silently when every package is ok', () => {
    stageDirs({ 'demo-sdist': ['demo-0.1.0.tar.gz'] });
    expect(() =>
      requireCompleteness(
        [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
        root,
      ),
    ).not.toThrow();
  });

  it('throws naming the missing target(s) per package', () => {
    expect(() =>
      requireCompleteness(
        [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
        root,
      ),
    ).toThrow(/demo.*sdist|missing/i);
  });

  it('throws with every missing target on a multi-target package', () => {
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
    ];
    const err = captureError(() => requireCompleteness(matrix, root));
    expect(err).toMatch(/x86_64-unknown-linux-gnu/);
    expect(err).toMatch(/aarch64-unknown-linux-gnu/);
  });

  // #89: users hit the completeness check with no hint about where the
  // artifact directory should live. Surface the naming contract inline.
  it('error message includes the expected artifact layout for each missing row', () => {
    const matrix: MatrixRow[] = [
      row({
        name: 'demo',
        kind: 'pypi',
        target: 'x86_64-unknown-linux-gnu',
        version: '0.1.0',
        artifact_name: 'demo-wheel-x86_64-unknown-linux-gnu',
      }),
    ];
    const err = captureError(() => requireCompleteness(matrix, root));
    expect(err).toMatch(/expected: artifacts\/demo-wheel-x86_64-unknown-linux-gnu\/demo-0\.1\.0-/);
    expect(err).toMatch(/plan\.md §12\.4/);
  });
});

describe('expectedLayout', () => {
  it('crates → {dir}/{name}-{version}.crate', () => {
    expect(
      expectedLayout(row({ name: 'foo', kind: 'crates', version: '1.2.3', artifact_name: 'foo-crate' })),
    ).toBe('artifacts/foo-crate/foo-1.2.3.crate');
  });

  it('pypi sdist → {dir}/{name}-{version}.tar.gz', () => {
    expect(
      expectedLayout(
        row({ name: 'foo', kind: 'pypi', target: 'sdist', version: '1.2.3', artifact_name: 'foo-sdist' }),
      ),
    ).toBe('artifacts/foo-sdist/foo-1.2.3.tar.gz');
  });

  it('pypi wheel → {dir}/{name}-{version}-<python-tags>.whl', () => {
    expect(
      expectedLayout(
        row({
          name: 'foo',
          kind: 'pypi',
          target: 'x86_64-unknown-linux-gnu',
          version: '1.2.3',
          artifact_name: 'foo-wheel-linux',
        }),
      ),
    ).toBe('artifacts/foo-wheel-linux/foo-1.2.3-<python-tags>.whl');
  });

  it('npm main → {dir}/package.json', () => {
    expect(
      expectedLayout(row({ name: 'foo', kind: 'npm', target: 'main', artifact_name: 'foo-main' })),
    ).toBe('artifacts/foo-main/package.json');
  });

  it('npm noarch → {dir}/package.json', () => {
    expect(
      expectedLayout(row({ name: 'foo', kind: 'npm', target: 'noarch', artifact_name: 'foo-pkg' })),
    ).toBe('artifacts/foo-pkg/package.json');
  });

  it('npm platform → {dir}/<binary-or-bundle>', () => {
    expect(
      expectedLayout(
        row({ name: 'foo', kind: 'npm', target: 'linux-x64-gnu', artifact_name: 'foo-linux-x64' }),
      ),
    ).toBe('artifacts/foo-linux-x64/<binary-or-bundle>');
  });
});

function captureError(fn: () => void): string {
  try {
    fn();
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

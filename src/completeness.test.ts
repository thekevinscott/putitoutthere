/**
 * Artifact completeness check tests. Default-on guardrail that refuses
 * to publish any package whose matrix didn't fully produce.
 *
 * Plan: §13.2.
 * Issue #13.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkCompleteness,
  expectedLayout,
  requireCompleteness,
  type MatrixRow,
} from './completeness.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'putitoutthere-artifacts-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relative: string, contents = 'x'): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

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
  it('crates noarch is ok when a .crate is present', () => {
    write('demo-crate/demo-0.1.0.crate');
    const out = checkCompleteness([row({})], root);
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('pypi sdist is ok when a .tar.gz is present', () => {
    write('demo-sdist/demo-0.1.0.tar.gz');
    const out = checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('pypi wheel is ok when a .whl is present', () => {
    write(
      'demo-wheel-x86_64-unknown-linux-gnu/demo-0.1.0-cp310-cp310-manylinux_2_17_x86_64.whl',
    );
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
    write('demo-npm-linux-x64-gnu/demo.node');
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
    write('demo-npm-main/package.json', '{}');
    const out = checkCompleteness(
      [row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });

  it('npm vanilla (target=noarch) is ok when package.json is present', () => {
    write('demo-vanilla/package.json', '{}');
    const out = checkCompleteness(
      [row({ kind: 'npm', target: 'noarch', artifact_name: 'demo-vanilla' })],
      root,
    );
    expect(out.get('demo')?.ok).toBe(true);
  });
});

describe('checkCompleteness: single package, issues', () => {
  it('reports a missing artifact directory as missing', () => {
    const out = checkCompleteness([row({})], root);
    const pkg = out.get('demo');
    expect(pkg?.ok).toBe(false);
    expect(pkg?.missing[0]?.reason).toMatch(/missing/i);
    expect(pkg?.missing[0]?.row.target).toBe('noarch');
  });

  it('reports an empty artifact directory as empty', () => {
    mkdirSync(join(root, 'demo-crate'));
    const out = checkCompleteness([row({})], root);
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/empty/i);
  });

  it('reports a crate artifact without a .crate file as wrong-shape', () => {
    write('demo-crate/junk.txt');
    const out = checkCompleteness([row({})], root);
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/shape|\.crate/i);
  });

  it('reports a pypi artifact with no .whl as wrong-shape', () => {
    write('demo-wheel-x86_64-unknown-linux-gnu/something.txt');
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
    write('demo-sdist/junk.txt');
    const out = checkCompleteness(
      [row({ kind: 'pypi', target: 'sdist', artifact_name: 'demo-sdist' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/sdist|tar\.gz/i);
  });

  it('reports an npm main artifact with no package.json as wrong-shape', () => {
    write('demo-npm-main/junk.txt');
    const out = checkCompleteness(
      [row({ kind: 'npm', target: 'main', artifact_name: 'demo-npm-main' })],
      root,
    );
    expect(out.get('demo')?.missing[0]?.reason).toMatch(/package\.json/i);
  });
});

describe('checkCompleteness: multi-package', () => {
  it('reports per package independently', () => {
    write('a-crate/a.crate');
    // b's artifact is missing entirely
    const matrix: MatrixRow[] = [
      row({ name: 'a', artifact_name: 'a-crate' }),
      row({ name: 'b', artifact_name: 'b-crate' }),
    ];
    const out = checkCompleteness(matrix, root);
    expect(out.get('a')?.ok).toBe(true);
    expect(out.get('b')?.ok).toBe(false);
  });

  it('reports every missing target on a package, not just the first', () => {
    // Package c expects 3 matrix rows; only one of its artifacts is present.
    write('c-wheel-x86/w.whl');
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
    write('demo-crate/demo.crate');
    expect(() => requireCompleteness([row({})], root)).not.toThrow();
  });

  it('throws naming the missing target(s) per package', () => {
    expect(() => requireCompleteness([row({})], root)).toThrow(
      /demo.*noarch|missing/i,
    );
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

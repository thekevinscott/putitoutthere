/**
 * Fixture plan snapshot tests. For each fixture, initialize a git
 * repo from the source tree, call `plan()`, and assert the matrix
 * shape matches expectations.
 *
 * Exercises:
 * - #29 pure-language shapes (1 row per package, no targets).
 * - #30 rust-in-language shapes (5 target rows + sdist / main).
 * - #31 polyglot cascades (depends_on transitivity).
 *
 * Not a byte-identical snapshot — we assert *shape*, which is what
 * changes when the plan logic breaks. Byte-identical snapshots are
 * brittle across version bumps.
 *
 * Issues #29, #30, #31.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { plan } from '../../src/plan.js';

let repo: string;

beforeEach(() => {
  repo = '';
});

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function prepareFixture(name: string): string {
  repo = mkdtempSync(join(tmpdir(), `fixture-${name}-`));
  cpSync(join(import.meta.dirname, name), repo, { recursive: true });
  rewritePlaceholders(repo, '0.1.0');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: repo });
  return repo;
}

function rewritePlaceholders(root: string, version: string): void {
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        walk(p);
        continue;
      }
      if (entry.name === 'fixtures.test.ts' || entry.name === 'README.md') continue;
      try {
        const s = readFileSync(p, 'utf8');
        if (s.includes('__VERSION__')) writeFileSync(p, s.replaceAll('__VERSION__', version), 'utf8');
      } catch {
        // Binary or unreadable; skip.
      }
    }
  };
  walk(root);
}

describe('#29 pure-language fixtures', () => {
  it('rust-crate-only → 1 crates row', async () => {
    const cwd = prepareFixture('rust-crate-only');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('crates');
    expect(rows[0]!.target).toBe('noarch');
  });

  it('python-pure-hatch → 1 pypi sdist row', async () => {
    const cwd = prepareFixture('python-pure-hatch');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('pypi');
  });

  it('python-pure-sdist-only → 1 pypi sdist row', async () => {
    const cwd = prepareFixture('python-pure-sdist-only');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(1);
  });

  it('js-vanilla → 1 npm noarch row', async () => {
    const cwd = prepareFixture('js-vanilla');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('npm');
    expect(rows[0]!.target).toBe('noarch');
  });
});

describe('#30 rust-in-language fixtures', () => {
  it('python-rust-maturin → 5 wheels + 1 sdist', async () => {
    const cwd = prepareFixture('python-rust-maturin');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'sdist')).toHaveLength(1);
    expect(rows.filter((r) => r.target !== 'sdist')).toHaveLength(5);
  });

  it('js-napi → 5 platform rows + 1 main', async () => {
    const cwd = prepareFixture('js-napi');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'main')).toHaveLength(1);
  });

  it('js-bundled-cli → 5 platform rows + 1 main', async () => {
    const cwd = prepareFixture('js-bundled-cli');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.target === 'main')).toHaveLength(1);
  });
});

describe('#31 polyglot fixtures', () => {
  it('js-python-no-rust → 1 pypi sdist + 1 npm noarch', async () => {
    const cwd = prepareFixture('js-python-no-rust');
    const rows = await plan({ cwd });
    expect(rows).toHaveLength(2);
    const byKind = new Map<string, number>();
    for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    expect(byKind.get('pypi')).toBe(1);
    expect(byKind.get('npm')).toBe(1);
  });

  it('polyglot-everything → rust + python (5+sdist) + npm (5+main)', async () => {
    const cwd = prepareFixture('polyglot-everything');
    const rows = await plan({ cwd });
    // 1 rust + 6 python + 6 npm = 13 rows.
    expect(rows).toHaveLength(13);
    const byName = new Map<string, number>();
    for (const r of rows) byName.set(r.name, (byName.get(r.name) ?? 0) + 1);
    expect(byName.get('piot-fixture-zzz-rust')).toBe(1);
    expect(byName.get('piot-fixture-zzz-python')).toBe(6);
    expect(byName.get('piot-fixture-zzz-cli')).toBe(6);
  });
});

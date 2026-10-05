/**
 * Integration test for the fixture-matrix gate (#670). Mocks nothing, and that
 * is deliberate: the gate's claim is that it reproduces the matrix
 * `e2e-fixture-job.yml`'s `plan` job computes, and a mocked filesystem or git
 * would only prove it agrees with this test's assumption. Rows, not job names.
 */

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

const FIXTURES_ROOT = fileURLToPath(new URL('../../../engine/tests/fixtures', import.meta.url));

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function fixtureMatrix(...args: readonly string[]): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  try {
    const code = await run(['node', 'piot-ci', 'fixture-matrix', ...args]);
    return { code, stdout: out.join(''), stderr: err.join('') };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

interface MatrixRowShape {
  name: string;
  kind: string;
  target: string;
  runs_on: string;
  artifact_name: string;
  build?: string;
}

interface MatrixDocument {
  fixture: string;
  matrix: MatrixRowShape[];
  has_pypi: boolean;
}

/** Assert exit 0 (surfacing stderr when it isn't) and parse the JSON document. */
async function documentFor(fixture: string): Promise<MatrixDocument> {
  const result = await fixtureMatrix(fixture);
  expect(`${result.code}: ${result.stderr}`).toBe('0: ');
  return JSON.parse(result.stdout) as MatrixDocument;
}

/** The last line of stderr — the only part the caller of a failed run reads. */
function reasonLine(stderr: string): string | undefined {
  return stderr.trimEnd().split('\n').at(-1);
}

function shape(row: MatrixRowShape): string {
  return `${row.kind}/${row.build ?? ''}/${row.target}`;
}

// The 18 rows run 33435391488 dispatched for
// `e2e (polyglot-everything-first-publish)`, in plan order. The hardest
// fixture: all three ecosystems, plus a dual-mode npm package whose napi and
// bundled-cli families share a target set.
const POLYGLOT_SHAPES = [
  'crates//noarch',
  'pypi/maturin/x86_64-unknown-linux-gnu',
  'pypi/maturin/aarch64-unknown-linux-gnu',
  'pypi/maturin/x86_64-apple-darwin',
  'pypi/maturin/aarch64-apple-darwin',
  'pypi/maturin/x86_64-pc-windows-msvc',
  'pypi/maturin/sdist',
  'npm/bundled-cli/x86_64-unknown-linux-gnu',
  'npm/bundled-cli/aarch64-unknown-linux-gnu',
  'npm/bundled-cli/x86_64-apple-darwin',
  'npm/bundled-cli/aarch64-apple-darwin',
  'npm/bundled-cli/x86_64-pc-windows-msvc',
  'npm/napi/x86_64-unknown-linux-gnu',
  'npm/napi/aarch64-unknown-linux-gnu',
  'npm/napi/x86_64-apple-darwin',
  'npm/napi/aarch64-apple-darwin',
  'npm/napi/x86_64-pc-windows-msvc',
  'npm/bundled-cli/main',
];

describe('piot-ci fixture-matrix (integration)', () => {
  it('computes polyglot-everything-first-publish as exactly the 18 rows the live run dispatched', async () => {
    const doc = await documentFor('polyglot-everything-first-publish');

    expect(doc.fixture).toBe('polyglot-everything-first-publish');
    expect(doc.matrix).toHaveLength(18);
    expect(doc.matrix.map(shape)).toEqual(POLYGLOT_SHAPES);
  });

  it('carries the whole structured row, not just the fields a name is built from', async () => {
    const doc = await documentFor('polyglot-everything-first-publish');

    expect(doc.matrix[0]).toMatchObject({
      name: 'piot-fixture-zzz-poly-rust-placeholder',
      kind: 'crates',
      target: 'noarch',
      runs_on: 'ubuntu-latest',
      artifact_name: 'piot-fixture-zzz-poly-rust-placeholder-crate',
    });
  });

  it('emits a vanilla npm package as one noarch row carrying no build mode', async () => {
    const doc = await documentFor('js-vanilla');

    expect(doc.matrix).toHaveLength(1);
    expect(doc.matrix[0]).toMatchObject({
      name: '@putitoutthere/piot-fixture-zzz-js-vanilla',
      kind: 'npm',
      target: 'noarch',
    });
    // The absent `build` is load-bearing downstream: #660's job name
    // interpolates it, and an empty slot is what produces the double space in
    // `build npm  (noarch)`. A row that defaulted it to a string would be
    // wrong in a way nothing else here would catch.
    expect(doc.matrix[0]).not.toHaveProperty('build');
  });

  it('reports has_pypi from the same plan the matrix came from', async () => {
    await expect(documentFor('polyglot-everything-first-publish')).resolves.toMatchObject({
      has_pypi: true,
    });
    await expect(documentFor('python-pure-sdist-only')).resolves.toMatchObject({ has_pypi: true });
    await expect(documentFor('js-vanilla')).resolves.toMatchObject({ has_pypi: false });
    await expect(documentFor('rust-vanilla-first-publish')).resolves.toMatchObject({
      has_pypi: false,
    });
  });

  it('resolves every declared e2e fixture to a non-empty matrix', { timeout: 60_000 }, async () => {
    const entries = await readdir(FIXTURES_ROOT, { withFileTypes: true });
    const fixtures = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(fixtures.length).toBeGreaterThan(0);

    for (const fixture of fixtures) {
      const doc = await documentFor(fixture);
      expect(doc.matrix.length, `${fixture} planned an empty matrix`).toBeGreaterThan(0);
    }
  });
});

describe('piot-ci fixture-matrix (integration): failure is legible', () => {
  // The caller of a failed run reads the exit code and *only the final line*
  // of stderr. A reason followed by anything — a stack trace, a trailing
  // diagnostic, a library's own warning — is a reason the caller never sees,
  // and no diff makes that visible. Hence: assert the last line exactly,
  // not `toContain`.
  it('puts the reason on the last line of stderr for an unknown fixture, and prints no stdout', async () => {
    const result = await fixtureMatrix('no-such-fixture');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(reasonLine(result.stderr)).toBe(
      "piot-ci fixture-matrix: no fixture named 'no-such-fixture' under packages/engine/tests/fixtures",
    );
  });

  it('puts the reason on the last line of stderr when a fixture name is missing', async () => {
    const result = await fixtureMatrix();

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(reasonLine(result.stderr)).toBe(
      'piot-ci fixture-matrix: a fixture name is required (usage: piot-ci fixture-matrix <fixture>)',
    );
  });

  it('rejects a fixtures-root entry that is not a fixture rather than planning an empty matrix', async () => {
    const result = await fixtureMatrix('README.md');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(reasonLine(result.stderr)).toBe(
      "piot-ci fixture-matrix: no fixture named 'README.md' under packages/engine/tests/fixtures",
    );
  });
});

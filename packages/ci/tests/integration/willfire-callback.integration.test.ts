/**
 * Integration test for the willfire-callback adapter (#681).
 *
 * Drives the real `piot-ci willfire-callback` dispatch in-process (`run()`
 * from `cli.ts`) with the WILLFIRE_* env willfire sets. Deliberately mocks
 * nothing in the delegated fixture-matrix pipeline — no mocked filesystem,
 * no mocked git, no mocked `plan()` — for the same reason
 * `fixture-matrix.integration.test.ts` doesn't: the adapter's whole claim
 * is that it reproduces exactly what `piot-ci fixture-matrix` (and, through
 * it, the real `plan` job) computes, and mocking that chain would only
 * prove this test agrees with a shape it assumed itself. Everything the
 * chain touches is local and deterministic (fixture sources on disk, a
 * throwaway git repo in a temp dir, no network), so exercising it for real
 * here is both stronger and cheap.
 *
 * The one seam this test does control: `process.cwd()`. In production,
 * willfire sets cwd to the head checkout's repo root; under `pnpm
 * --filter @putitoutthere/ci run test:integration` the real cwd is
 * `packages/ci`, so the adapter's checkout-layout guard (does
 * `.github/workflows/e2e-fixture-job.yml` exist under cwd?) needs a cwd
 * pointed at the actual repo root to find the real file — spying on
 * `process.cwd()` gets it there without touching the filesystem mock-wise.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function willfireCallback(): Promise<Captured> {
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
    const code = await run(['node', 'piot-ci', 'willfire-callback']);
    return { code, stdout: out.join(''), stderr: err.join('') };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

/** The last line of stderr — the only part willfire itself reads on failure. */
function reasonLine(stderr: string): string | undefined {
  return stderr.trimEnd().split('\n').at(-1);
}

interface WillfireCallbackDocument {
  matrix: string;
  has_pypi: string;
}

const ENV_KEYS = ['WILLFIRE_JOB', 'WILLFIRE_WORKFLOW', 'WILLFIRE_WORKFLOW_REPO', 'WILLFIRE_INPUTS', 'WILLFIRE_NEEDS'];

function setValidEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): void {
  const values: Record<string, string> = {
    WILLFIRE_JOB: 'plan',
    WILLFIRE_WORKFLOW: '.github/workflows/e2e-fixture-job.yml',
    WILLFIRE_WORKFLOW_REPO: 'thekevinscott/putitoutthere',
    WILLFIRE_INPUTS: '{"fixture":"js-vanilla","simulate_no_dist":"false"}',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  vi.spyOn(process, 'cwd').mockReturnValue(REPO_ROOT);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe('piot-ci willfire-callback (integration): success', () => {
  it('emits a flat, all-string JSON envelope whose matrix mirrors the real plan job output', async () => {
    setValidEnv();
    const result = await willfireCallback();

    expect(`${result.code}: ${result.stderr}`).toBe('0: ');
    expect(result.stdout.endsWith('\n')).toBe(true);

    const doc = JSON.parse(result.stdout) as WillfireCallbackDocument;
    expect(Object.keys(doc).sort()).toEqual(['has_pypi', 'matrix']);
    expect(typeof doc.matrix).toBe('string');
    expect(doc.has_pypi).toBe('false');

    const rows = JSON.parse(doc.matrix) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: '@putitoutthere/piot-fixture-zzz-js-vanilla',
      kind: 'npm',
      target: 'noarch',
    });
  });

  it('reports has_pypi true for a fixture whose matrix includes a pypi row', async () => {
    setValidEnv({ WILLFIRE_INPUTS: '{"fixture":"polyglot-everything-first-publish"}' });
    const result = await willfireCallback();

    expect(`${result.code}: ${result.stderr}`).toBe('0: ');
    const doc = JSON.parse(result.stdout) as WillfireCallbackDocument;
    expect(doc.has_pypi).toBe('true');
    expect(JSON.parse(doc.matrix)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'pypi' })]));
  });

  it('ignores WILLFIRE_NEEDS and unknown WILLFIRE_INPUTS keys entirely', async () => {
    setValidEnv({ WILLFIRE_NEEDS: '{"some-upstream-job":{"outputs":{"x":"y"}}}' });
    const result = await willfireCallback();
    expect(result.code).toBe(0);
  });

  it('is pure: the same env yields byte-identical stdout across sequential invocations', async () => {
    setValidEnv();
    const first = await willfireCallback();
    const second = await willfireCallback();
    expect(first.code).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });
});

describe('piot-ci willfire-callback (integration): failure is legible', () => {
  it('hard-fails on an unsupported WILLFIRE_JOB, printing nothing to stdout', async () => {
    setValidEnv({ WILLFIRE_JOB: 'build' });
    const result = await willfireCallback();
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(reasonLine(result.stderr)).toBe(
      "willfire-callback: unsupported WILLFIRE_JOB 'build' (only 'plan' is supported)",
    );
  });

  it('hard-fails when WILLFIRE_WORKFLOW does not name the fixture-matrix callee', async () => {
    setValidEnv({ WILLFIRE_WORKFLOW: '.github/workflows/release.yml' });
    const result = await willfireCallback();
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(reasonLine(result.stderr)).toBe(
      "willfire-callback: unexpected WILLFIRE_WORKFLOW '.github/workflows/release.yml' (expected '.github/workflows/e2e-fixture-job.yml')",
    );
  });

  it('hard-fails on a cross-repo WILLFIRE_WORKFLOW_REPO', async () => {
    setValidEnv({ WILLFIRE_WORKFLOW_REPO: 'someone-else/putitoutthere' });
    const result = await willfireCallback();
    expect(result.code).not.toBe(0);
    expect(reasonLine(result.stderr)).toBe(
      "willfire-callback: unexpected WILLFIRE_WORKFLOW_REPO 'someone-else/putitoutthere' (expected 'thekevinscott/putitoutthere')",
    );
  });

  it('hard-fails on missing WILLFIRE_INPUTS', async () => {
    setValidEnv({ WILLFIRE_INPUTS: undefined as unknown as string });
    delete process.env.WILLFIRE_INPUTS;
    const result = await willfireCallback();
    expect(result.code).not.toBe(0);
    expect(reasonLine(result.stderr)).toBe('willfire-callback: WILLFIRE_INPUTS must be set');
  });

  it('hard-fails on a WILLFIRE_INPUTS object missing a fixture field', async () => {
    setValidEnv({ WILLFIRE_INPUTS: '{"simulate_no_dist":"false"}' });
    const result = await willfireCallback();
    expect(result.code).not.toBe(0);
    expect(reasonLine(result.stderr)).toBe("willfire-callback: WILLFIRE_INPUTS is missing a string 'fixture' field");
  });

  it('surfaces the delegated fixture-matrix failure for an unknown fixture, with no stdout', async () => {
    setValidEnv({ WILLFIRE_INPUTS: '{"fixture":"no-such-fixture"}' });
    const result = await willfireCallback();
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(reasonLine(result.stderr)).toBe(
      "willfire-callback: piot-ci fixture-matrix: no fixture named 'no-such-fixture' under packages/engine/tests/fixtures",
    );
  });

  it('fails closed on a checkout layout mismatch even when every env var is otherwise valid', async () => {
    const emptyCwd = await mkdtemp(join(tmpdir(), 'piot-willfire-callback-layout-'));
    try {
      vi.spyOn(process, 'cwd').mockReturnValue(emptyCwd);
      setValidEnv();
      const result = await willfireCallback();
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(reasonLine(result.stderr)).toBe(
        "willfire-callback: expected workflow file '.github/workflows/e2e-fixture-job.yml' not found under the current checkout — layout mismatch",
      );
    } finally {
      await rm(emptyCwd, { recursive: true, force: true });
    }
  });
});

/**
 * Canary E2E test. Runs the `putitoutthere` CLI against a real fixture
 * repo.
 *
 * Gating:
 * - The `plan` + dry-run path always runs (no network).
 * - The real-publish path gates on `PIOT_E2E_PUBLISH=1` and assumes
 *   NPM_TOKEN is in the environment.
 *
 * Issue #28.
 */

import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canaryVersion, makeE2ERepo, runPiot, shouldActuallyPublish, type E2ERepo } from './harness.js';

let repo: E2ERepo;

beforeEach(() => {
  repo = makeE2ERepo({ fixture: 'e2e-canary' });
});

afterEach(() => {
  rmSync(repo.cwd, { recursive: true, force: true });
});

describe('canaryVersion', () => {
  it('produces a monotonic 0.0.{unix-seconds} shape', () => {
    const v = canaryVersion();
    expect(v).toMatch(/^0\.0\.\d{10}$/);
  });

  it('advances on subsequent calls', async () => {
    const v1 = canaryVersion();
    await new Promise((r) => setTimeout(r, 1100));
    const v2 = canaryVersion();
    expect(Number(v2.split('.')[2])).toBeGreaterThan(Number(v1.split('.')[2]));
  });
});

describe('e2e: plan', () => {
  it('emits a single npm-vanilla row for the canary fixture', () => {
    const out = runPiot(['plan', '--json'], repo.cwd);
    const matrix = JSON.parse(out.trim()) as Array<{ name: string; kind: string; target: string; version: string }>;
    expect(matrix).toHaveLength(1);
    expect(matrix[0]!.name).toBe('piot-fixture-zzz-cli');
    expect(matrix[0]!.kind).toBe('npm');
    expect(matrix[0]!.target).toBe('noarch');
    expect(matrix[0]!.version).toBe(repo.version);
  });
});

describe('e2e: publish --dry-run', () => {
  it('runs without side effects (auth presence is enough to pass pre-flight)', () => {
    const out = runPiot(['publish', '--dry-run', '--json'], repo.cwd, {
      NODE_AUTH_TOKEN: 'e2e-dry-run-placeholder',
    });
    const result = JSON.parse(out.trim()) as { ok: boolean; published: unknown[] };
    expect(result.ok).toBe(true);
    // dry-run emits a `skipped` entry; registry not touched.
    expect(result.published).toHaveLength(1);
  });
});

describe('e2e: publish (live registry)', () => {
  it.skipIf(!shouldActuallyPublish())(
    'publishes to npm and creates a tag (requires PIOT_E2E_PUBLISH=1)',
    () => {
      const out = runPiot(['publish', '--json'], repo.cwd, {
        NODE_AUTH_TOKEN: process.env.NPM_TOKEN ?? '',
      });
      const result = JSON.parse(out.trim()) as {
        ok: boolean;
        published: Array<{ package: string; version: string; result: { status: string } }>;
      };
      expect(result.ok).toBe(true);
      expect(result.published[0]!.result.status).toMatch(/published|already-published/);
    },
  );
});

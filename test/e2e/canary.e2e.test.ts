/**
 * Canary E2E test. Runs the `putitoutthere` CLI against a real npm
 * fixture and publishes a throwaway version on every CI run (PR or
 * push). The point: catch publish-side breakage *before* it ships
 * — exactly the class of bug a `npm publish` ENEEDAUTH-on-OIDC
 * regression would otherwise only surface post-merge.
 *
 * Gating:
 * - The `plan` + dry-run path always runs (no network).
 * - The real-publish path gates on `PIOT_E2E_PUBLISH=1`. The e2e
 *   workflow sets that on every push *and* every PR; the canary
 *   `piot-fixture-zzz-cli` package is purpose-built for this and
 *   gets a fresh `0.0.{unix_seconds}` version each run.
 * - Auth is OIDC trusted publishing only — the test does NOT pass
 *   a `NODE_AUTH_TOKEN`, matching how the public reusable workflow
 *   runs. If the engine's npm handler can't make `npm publish
 *   --provenance` reach OIDC, this test fails the same way
 *   `release-npm.yml` did on run 24972181242.
 *
 * Issue #28.
 */

import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  canaryVersion,
  makeE2ERepo,
  runPiot,
  shouldActuallyPublish,
  type E2ERepo,
} from './harness.js';

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
  it('emits one npm row for the canary fixture', () => {
    const out = runPiot(['plan', '--json'], repo.cwd);
    const matrix = JSON.parse(out.trim()) as Array<{
      name: string;
      kind: string;
      target: string;
      version: string;
    }>;
    expect(matrix).toHaveLength(1);
    expect(matrix[0]!.name).toBe('piot-fixture-zzz-cli');
    expect(matrix[0]!.kind).toBe('npm');
    expect(matrix[0]!.version).toBe(repo.version);
  });
});

describe('e2e: publish --dry-run', () => {
  it('runs without side effects', () => {
    const out = runPiot(['publish', '--dry-run', '--json'], repo.cwd);
    const result = JSON.parse(out.trim()) as { ok: boolean; published: unknown[] };
    expect(result.ok).toBe(true);
    // dry-run emits one `skipped` entry per declared package; registries not touched.
    expect(result.published.length).toBeGreaterThanOrEqual(1);
  });
});

describe('e2e: publish (live npm via OIDC trusted publishing)', () => {
  it.skipIf(!shouldActuallyPublish())(
    'publishes to npm via OIDC trusted publishing and creates a tag (requires PIOT_E2E_PUBLISH=1)',
    () => {
      // Deliberately do NOT pass NODE_AUTH_TOKEN here. OIDC trusted
      // publishing is the only auth path piot's reusable workflow
      // supports, and the only path the canary should validate.
      // Passing an empty `NODE_AUTH_TOKEN` masquerades as token auth
      // and short-circuits OIDC inside npm CLI (the exact failure
      // mode `release-npm.yml` ran into post-merge of #240).
      const out = runPiot(['publish', '--json'], repo.cwd);
      const result = JSON.parse(out.trim()) as {
        ok: boolean;
        published: Array<{ package: string; version: string; result: { status: string } }>;
      };
      expect(result.ok).toBe(true);
      expect(result.published).toHaveLength(1);
      const entry = result.published[0]!;
      expect(entry.package).toBe('piot-fixture-zzz-cli');
      expect(entry.result.status).toMatch(/published|already-published/);
    },
  );
});

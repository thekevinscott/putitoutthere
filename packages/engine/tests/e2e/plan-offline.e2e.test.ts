/**
 * `piot plan` with npm unreachable, against the real CLI — the e2e twin of
 * `tests/integration/plan-offline-verdict.integration.test.ts` (#650).
 *
 * Shells out to the built CLI (`node dist/cli-bin.js plan --json`) with
 * `npm_config_registry` pointed at a hostname under the reserved `.invalid`
 * TLD (RFC 2606), so the real `npm view` the npm handler runs gets a real
 * NXDOMAIN from the real resolver. That is the sandbox condition from #650
 * — `docker run --network none` — reproduced without a container, and it is
 * the only tier that exercises the actual npm CLI's actual retry behaviour.
 * A mock cannot tell you what npm does with a dead name; this can.
 *
 * Red before the fix: `npm view` burns npm's own retry ladder
 * (`fetch-retries=2` → ~10s then ~60s) before failing, and the handler reads
 * that failure as "the version is not published", so `plan` takes ~70s and
 * then claims the package WOULD PUBLISH — an assertion it has no evidence
 * for. Green after: one bounded probe, `verdict: unknown`, ~1s.
 *
 * No publish, no auth, no writes — `plan` only reads.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issue #650.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

/**
 * `.invalid` is reserved by RFC 2606 and guaranteed never to resolve, so
 * this is a deterministic DNS failure on any network — including a CI
 * runner that has one.
 */
const DEAD_REGISTRY = 'https://registry.piot-offline-probe.invalid/';

/**
 * Upper bound on a plan run whose only registry probe cannot resolve.
 * The regression this guards took ~70s (npm's 10s + 60s retry ladder); the
 * bounded probe takes ~1s. 30s sits an order of magnitude above the fixed
 * path and well under the broken one, so it separates the two without
 * being a latency benchmark — the verdict assertion below is the primary
 * claim, this one pins the symptom the issue was filed about.
 */
const OFFLINE_BUDGET_MS = 30_000;

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

interface PlanJson {
  matrix: Array<{ name: string; kind: string }>;
  verdicts: Array<{ package: string; version: string; verdict: string }>;
}

/** Shell out to the real CLI with npm pointed at a name that cannot resolve. */
function runOfflineCli(args: string[]): { code: number; stdout: string; stderr: string; ms: number } {
  const env = { ...process.env, npm_config_registry: DEAD_REGISTRY };
  // Keep the run hermetic: drop $GITHUB_OUTPUT so plan's matrix= append
  // doesn't leak into the e2e job's step outputs.
  delete env.GITHUB_OUTPUT;
  const started = Date.now();
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '', ms: Date.now() - started };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      ms: Date.now() - started,
    };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-plan-offline-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(repo, 'packages', 'js'), { recursive: true });
  writeFileSync(
    join(repo, 'packages', 'js', 'package.json'),
    '{"name":"piot-fixture-zzz-offline-probe","version":"0.0.0"}\n',
    'utf8',
  );
  writeFileSync(
    join(repo, 'putitoutthere.toml'),
    `[putitoutthere]
version = 1

[[package]]
name  = "fixture-js"
kind  = "npm"
npm   = "piot-fixture-zzz-offline-probe"
path  = "packages/js"
globs = ["packages/js/**"]
`,
    'utf8',
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('piot plan with an unreachable npm registry (#650)', () => {
  it(
    'reports UNKNOWN and returns promptly instead of retrying a dead name',
    { timeout: 180_000 },
    () => {
      const res = runOfflineCli([
        'plan', '--json', '--cwd', repo, '--release-packages', 'fixture-js@1.2.3',
      ]);

      expect(res.code, `plan stderr:\n${res.stderr}`).toBe(0);
      const out = JSON.parse(res.stdout) as PlanJson;

      // The matrix — the output check-name prediction consumes — is emitted
      // regardless: the verdict read degrades, it never aborts the plan.
      expect(out.matrix.map((r) => r.name)).toContain('fixture-js');

      // The registry could not be reached, so the verdict is UNKNOWN. It is
      // not PUBLISH: claiming a publish will happen without having asked the
      // registry is the release surprise `plan` exists to prevent.
      const verdict = out.verdicts.find((v) => v.package === 'fixture-js');
      expect(verdict, `plan stdout:\n${res.stdout}`).toMatchObject({
        version: '1.2.3',
        verdict: 'unknown',
      });

      // ...and it got there without paying npm's retry ladder for a name
      // that will never resolve.
      expect(res.ms, `plan took ${res.ms}ms against an unresolvable registry`).toBeLessThan(
        OFFLINE_BUDGET_MS,
      );
    },
  );
});

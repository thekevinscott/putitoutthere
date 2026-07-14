/**
 * `piot plan` publish/skip verdict against the real CLI + real crates.io
 * — the e2e twin of `tests/integration/plan-status.integration.test.ts`.
 *
 * Shells out to the built CLI (`node dist/cli-bin.js plan … --json`)
 * pointed at piot's own live fixture crate `piot-fixture-zzz-poly-rust`.
 * `--release-packages` pins the planned version, so the verdict is
 * deterministic: the crate's current live version is already published
 * (→ SKIP, a real isPublished 200 against crates.io), while an
 * implausible version is not (→ PUBLISH, a real 404). This is the tier
 * that fails if the real isPublished endpoint shape diverges from the
 * mocked one. No publish, no auth — plan only reads.
 *
 * Red before the feature: `plan --json` emits the bare matrix array with
 * no verdicts.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issues #403, #412.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const CRATE = 'piot-fixture-zzz-poly-rust';

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The crate's current newest published version on crates.io. */
async function liveVersion(): Promise<string> {
  const res = await fetch(`https://crates.io/api/v1/crates/${CRATE}`, {
    headers: { 'user-agent': 'piot-e2e-plan-status' },
  });
  const body = (await res.json()) as { crate: { newest_version: string } };
  return body.crate.newest_version;
}

interface PlanJson {
  matrix: Array<{ name: string }>;
  verdicts: Array<{ package: string; version: string; verdict: string }>;
  skew: Array<{ dependent: string; dependency: string }>;
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  // Keep the run hermetic: drop $GITHUB_OUTPUT so plan's matrix= append
  // doesn't leak into the e2e job's step outputs.
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-plan-status-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(
    join(repo, 'putitoutthere.toml'),
    `[putitoutthere]
version = 1

[[package]]
name  = "fixture-rust"
kind  = "crates"
crate = "${CRATE}"
path  = "packages/rust"
globs = ["packages/rust/**"]
`,
    'utf8',
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('piot plan publish/skip against crates.io (#412)', () => {
  it("reports SKIP for the crate's live version and PUBLISH for an unpublished one", async () => {
    const version = await liveVersion();

    // The live version is already on crates.io → SKIP.
    const skip = runCli(['plan', '--release-packages', `fixture-rust@${version}`, '--json', '--cwd', repo]);
    const skipPlan = JSON.parse(skip.stdout) as PlanJson;
    const skipVerdict = skipPlan.verdicts.find((v) => v.package === 'fixture-rust');
    expect(skipVerdict, `plan output:\n${skip.stdout}\n${skip.stderr}`).toMatchObject({
      version,
      verdict: 'skip',
    });

    // An implausible version is not published → PUBLISH.
    const pub = runCli(['plan', '--release-packages', 'fixture-rust@99.99.99', '--json', '--cwd', repo]);
    const pubPlan = JSON.parse(pub.stdout) as PlanJson;
    const pubVerdict = pubPlan.verdicts.find((v) => v.package === 'fixture-rust');
    expect(pubVerdict, `plan output:\n${pub.stdout}\n${pub.stderr}`).toMatchObject({
      version: '99.99.99',
      verdict: 'publish',
    });
  });
});

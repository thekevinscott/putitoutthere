/**
 * `piot plan`'s `unpublished_kinds` $GITHUB_OUTPUT key against the real CLI
 * and the real crates.io — the e2e twin of
 * `tests/integration/crates-auth-gate.integration.test.ts` (#622).
 *
 * The reusable workflow gates its crates.io OIDC exchange on this key, so a
 * wrong answer here is a failed release: too narrow and a crates publish
 * arrives with no credential; too wide and a re-run with nothing left to ship
 * still demands a working trusted publisher and dies before npm and PyPI get
 * their turn (the #622 repro).
 *
 * Shells out to the built CLI (`node dist/cli-bin.js plan …`) pointed at
 * piot's own live fixture crate, with `$GITHUB_OUTPUT` aimed at a temp file.
 * `--release-packages` pins the planned version so the verdict is
 * deterministic: the crate's current live version is already published (a real
 * `isPublished` 200 → nothing to authenticate for), while an implausible
 * version is not (a real 404 → the credential is genuinely needed). This is
 * the tier that fails if the real registry read diverges from the mocked one.
 * No publish, no auth — plan only reads.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issue #622.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const CRATE = 'piot-fixture-zzz-poly-rust';

let repo: string;
let outputFile: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The crate's current newest published version on crates.io. */
async function liveVersion(): Promise<string> {
  const res = await fetch(`https://crates.io/api/v1/crates/${CRATE}`, {
    headers: { 'user-agent': 'piot-e2e-crates-auth-gate' },
  });
  const body = (await res.json()) as { crate: { newest_version: string } };
  return body.crate.newest_version;
}

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
  /** The `key=value` lines the CLI appended to $GITHUB_OUTPUT. */
  outputs: Record<string, string>;
}

/**
 * Shell out to the real CLI with `$GITHUB_OUTPUT` aimed at a fresh temp file,
 * so the assertions read exactly what a workflow's `needs.<job>.outputs.<key>`
 * would resolve to — and nothing leaks into the e2e job's own step outputs.
 */
function runCli(args: string[]): CliRun {
  writeFileSync(outputFile, '', 'utf8');
  const env = { ...process.env, GITHUB_OUTPUT: outputFile };
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    code = e.status ?? 1;
    stdout = e.stdout?.toString() ?? '';
    stderr = e.stderr?.toString() ?? '';
  }
  const outputs: Record<string, string> = {};
  for (const line of readFileSync(outputFile, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) {continue;}
    outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return { code, stdout, stderr, outputs };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-crates-auth-gate-e2e-'));
  outputFile = join(repo, 'gha-output.txt');
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

describe('piot plan unpublished_kinds against crates.io (#622)', () => {
  it('drops crates for a version already on the registry and keeps it for one that is not', async () => {
    const version = await liveVersion();

    // Already on crates.io: the run has no crates.io work, so the reusable
    // workflow must not require a crates.io credential to complete it.
    const current = runCli(['plan', '--release-packages', `fixture-rust@${version}`, '--cwd', repo]);
    expect(current.code, `plan output:\n${current.stdout}\n${current.stderr}`).toBe(0);
    expect(
      current.outputs.unpublished_kinds,
      `plan must emit unpublished_kinds:\n${current.stdout}\n${current.stderr}`,
    ).toBeDefined();
    expect(JSON.parse(current.outputs.unpublished_kinds!) as string[]).toEqual([]);
    // The build matrix is untouched — only the auth gate narrows.
    expect(JSON.parse(current.outputs.matrix!) as unknown[]).not.toEqual([]);

    // Not on crates.io: the credential is genuinely needed.
    const pending = runCli(['plan', '--release-packages', 'fixture-rust@99.99.99', '--cwd', repo]);
    expect(pending.code, `plan output:\n${pending.stdout}\n${pending.stderr}`).toBe(0);
    expect(JSON.parse(pending.outputs.unpublished_kinds!) as string[]).toEqual(['crates']);
  });
});

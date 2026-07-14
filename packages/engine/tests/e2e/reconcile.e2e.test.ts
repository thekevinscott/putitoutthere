/**
 * `piot reconcile` against the real CLI + real crates.io — the e2e twin
 * of `tests/integration/reconcile.integration.test.ts`.
 *
 * Where the integration test imports the engine in-process and mocks the
 * registry HTTP (msw), this one **shells out to the built CLI**
 * (`node dist/cli-bin.js reconcile …`) pointed at piot's own live fixture
 * crate `piot-fixture-zzz-poly-rust`, whose current version is published
 * with no local git tag. reconcile reads the real latest version (a live
 * crates.io GET) and backfills the tag.
 *
 * No publish, no auth, no build: reconcile only reads the registry and
 * writes a git tag. The throwaway repo has no `origin`, so the tag push
 * is warned-not-fatal (same as the publish-path auto-heal e2e) — the
 * local tag is the observable contract. With a single package there is
 * no sibling tag to borrow, so the tag lands at HEAD.
 *
 * Red before the command exists: `reconcile` is an unknown subcommand.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issues #403, #410.
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

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** The crate's current newest published version on crates.io. */
async function liveVersion(): Promise<string> {
  const res = await fetch(`https://crates.io/api/v1/crates/${CRATE}`, {
    headers: { 'user-agent': 'piot-e2e-reconcile' },
  });
  const body = (await res.json()) as { crate: { newest_version: string } };
  return body.crate.newest_version;
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
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
  repo = mkdtempSync(join(tmpdir(), 'piot-reconcile-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  // reconcile reads only config + tags + the registry — no manifest, no
  // preflight — so a bare config that names the live crate is enough.
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

describe('piot reconcile against crates.io (#410)', () => {
  it('backfills the missing tag for an already-published crate, idempotently', async () => {
    const version = await liveVersion();

    // First run: crate@version is live on crates.io with no local tag, so
    // reconcile must create it (at HEAD — no sibling package to borrow a
    // commit from).
    const first = runCli(['reconcile', '--cwd', repo]);
    expect(
      git(['tag', '-l']),
      `reconcile output:\n${first.stdout}\n${first.stderr}`,
    ).toContain(`fixture-rust-v${version}`);

    // Second run: the tag already exists — reconcile is a clean no-op,
    // not an error, and leaves exactly one such tag.
    const second = runCli(['reconcile', '--cwd', repo]);
    expect(second.code, `reconcile re-run output:\n${second.stdout}\n${second.stderr}`).toBe(0);
    const tags = git(['tag', '-l'])
      .split('\n')
      .filter((t) => t === `fixture-rust-v${version}`);
    expect(tags).toHaveLength(1);
  });
});

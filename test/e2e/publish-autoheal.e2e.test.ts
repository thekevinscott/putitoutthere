/**
 * Publish-path auto-heal (#407) against the real CLI + the real registry
 * — the e2e twin of `publish-autoheal.integration.test.ts`.
 *
 * Where the integration test mocks the publish boundary, this shells out
 * to the built CLI (`node dist/cli-bin.js publish`) and lets it hit
 * crates.io for real, pointed at the live, piot-owned fixture crate
 * `piot-fixture-zzz-poly-rust`. That version is already published with no
 * local git tag, so publish takes the skip path — it never actually
 * publishes (no OIDC/build needed: a throwaway token clears the auth
 * pre-flight, and crates rows need no staged artifact). The contract: the
 * heal still writes the missing tag.
 *
 * Red before the fix: the skip path writes no tag.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issues #403, #407.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/** The crate's current newest published version on crates.io. */
async function liveVersion(): Promise<string> {
  const res = await fetch(`https://crates.io/api/v1/crates/${CRATE}`, {
    headers: { 'user-agent': 'piot-e2e-autoheal' },
  });
  const body = (await res.json()) as { crate: { newest_version: string } };
  return body.crate.newest_version;
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way. */
function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  // A throwaway token clears the auth pre-flight (never used — the skip
  // path doesn't publish). Drop the GitHub vars so the repo-visibility /
  // URL-match pre-flight no-ops (it skips when GITHUB_REPOSITORY is unset).
  const env = { ...process.env, CARGO_REGISTRY_TOKEN: 'piot-e2e-autoheal-placeholder' };
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_TOKEN;
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
  repo = mkdtempSync(join(tmpdir(), 'piot-autoheal-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  writeRepoFile(
    'putitoutthere.toml',
    `[putitoutthere]
version = 1

[[package]]
name  = "fixture-rust"
kind  = "crates"
crate = "${CRATE}"
path  = "packages/rust"
globs = ["packages/rust/**"]
`,
  );
  // Minimal manifest so the crates pre-flight (name match + description +
  // license) passes. cargo is never invoked — the version is already
  // live, so publish takes the skip path.
  writeRepoFile(
    'packages/rust/Cargo.toml',
    `[package]
name = "${CRATE}"
version = "0.0.1"
edition = "2021"
description = "piot auto-heal e2e fixture; never published from here"
license = "MIT"
`,
  );
  writeRepoFile('packages/rust/src/lib.rs', '');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('publish-path auto-heal against crates.io (#407)', () => {
  it('writes the missing tag for an already-published crate version', async () => {
    const version = await liveVersion();

    // crate@version is already live on crates.io with no local tag.
    // `--release-packages` plans exactly that version, so publish takes
    // the real skip path (a real isPublished GET against crates.io) — the
    // heal must still write the tag.
    const { stdout, stderr } = runCli([
      'publish', '--release-packages', `fixture-rust@${version}`, '--cwd', repo,
    ]);

    const tags = git(['tag', '-l']);
    expect(tags, `publish output:\n${stdout}\n${stderr}`).toContain(`fixture-rust-v${version}`);
  });
});

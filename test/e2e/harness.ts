/**
 * E2E harness. Runs the `putitoutthere` CLI against a temporary
 * canary fixture repo.
 *
 * Use `canaryVersion()` to generate a monotonically-increasing
 * version that won't collide with past runs on real registries.
 *
 * Issue #28. Plan: §23.4.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export interface E2EOptions {
  /** Path relative to `test/fixtures/` to copy into a temp worktree. */
  fixture: string;
  /** Override for unit testing harness helpers. */
  version?: string;
}

export interface E2ERepo {
  cwd: string;
  version: string;
  configPath: string;
}

/**
 * Copies `test/fixtures/{fixture}` into a temp dir, initializes a
 * fresh git repo, and bumps any version placeholders to
 * `canaryVersion()`.
 */
export function makeE2ERepo(opts: E2EOptions): E2ERepo {
  const cwd = mkdtempSync(join(tmpdir(), 'piot-e2e-'));
  const src = fileURLToPath(new URL(`../fixtures/${opts.fixture}/`, import.meta.url));
  cpSync(src, cwd, { recursive: true });

  const version = opts.version ?? canaryVersion();
  rewritePlaceholders(cwd, version);

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd });
  execFileSync('git', ['config', 'user.email', 'e2e@putitoutthere.dev'], { cwd });
  execFileSync('git', ['config', 'user.name', 'piot e2e'], { cwd });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd });
  execFileSync('git', ['config', 'tag.gpgsign', 'false'], { cwd });
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['commit', '-q', '-m', 'e2e: initial fixture'], { cwd });

  return { cwd, version, configPath: join(cwd, 'putitoutthere.toml') };
}

/**
 * `0.0.{unix_seconds}` — 10-digit patch lane. Monotonic across runs.
 * crates.io's immutable-publish rule means we can't re-use versions;
 * this guarantees a fresh slot every time.
 */
export function canaryVersion(): string {
  return `0.0.${Math.floor(Date.now() / 1000)}`;
}

/**
 * Run the CLI against `cwd` and return stdout. stderr is piped
 * through so test failures print context.
 */
export function runPiot(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const out = execFileSync('node', [CLI, ...args, '--cwd', cwd], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return out;
}

/** True when the opt-in env var is set. Gates destructive registry ops. */
export function shouldActuallyPublish(): boolean {
  return process.env.PIOT_E2E_PUBLISH === '1';
}

/* ---------------------------- internals ---------------------------- */

function rewritePlaceholders(cwd: string, version: string): void {
  rewriteFile(join(cwd, 'putitoutthere.toml'), version);
  rewriteFile(join(cwd, 'package.json'), version);
  rewriteFile(join(cwd, 'Cargo.toml'), version);
  rewriteFile(join(cwd, 'pyproject.toml'), version);
}

function rewriteFile(path: string, version: string): void {
  try {
    const raw = readFileSync(path, 'utf8');
    writeFileSync(path, raw.replaceAll('__VERSION__', version), 'utf8');
    /* v8 ignore next 2 -- not every fixture has every file */
  } catch {
    // File missing. Skip.
  }
}

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
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../dist/cli-bin.js', import.meta.url));

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
 * Run the CLI against `cwd` and return stdout. On non-zero exit,
 * throw with stderr folded into the message so vitest's failure
 * report actually shows the CLI's error (handler stderr, etc.)
 * instead of a bare "Command failed".
 */
export function runPiot(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  try {
    return execFileSync('node', [CLI, ...args, '--cwd', cwd], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number | null };
    const stdout = Buffer.isBuffer(e.stdout) ? e.stdout.toString('utf8') : (e.stdout ?? '');
    const stderr = Buffer.isBuffer(e.stderr) ? e.stderr.toString('utf8') : (e.stderr ?? '');
    const base = err instanceof Error ? err.message : String(err);
    const parts = [base];
    if (stderr.trim()) parts.push(`--- stderr ---\n${stderr.trim()}`);
    if (stdout.trim()) parts.push(`--- stdout ---\n${stdout.trim()}`);
    throw new Error(parts.join('\n'));
  }
}

/** True when the opt-in env var is set. Gates destructive registry ops. */
export function shouldActuallyPublish(): boolean {
  return process.env.PIOT_E2E_PUBLISH === '1';
}

/**
 * Build real artifacts for the canary packages and stage them under
 * `{repo.cwd}/artifacts/{artifact_name}/`, matching the shape that
 * `src/completeness.ts` expects in the matrix-CI publish flow (§13.2).
 *
 * - crates: `cargo package` emits `.crate` into `target/package/`.
 * - pypi sdist: `python -m build --sdist` emits `.tar.gz` into `dist/`.
 * - npm (vanilla/noarch): exempt from the completeness check; publishes
 *   straight from the source tree, so no staging needed.
 *
 * Runs on demand (not from makeE2ERepo) because the build tools aren't
 * needed for plan/dry-run paths and we don't want to slow those down.
 */
export function stageArtifacts(repo: E2ERepo): void {
  const artifactsRoot = join(repo.cwd, 'artifacts');
  mkdirSync(artifactsRoot, { recursive: true });

  // crates: cargo package produces a .crate in target/package/.
  const rustDir = join(repo.cwd, 'rust');
  execFileSync(
    'cargo',
    ['package', '--allow-dirty', '--no-verify', '--manifest-path', join(rustDir, 'Cargo.toml')],
    { cwd: repo.cwd, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const crateStage = join(artifactsRoot, 'piot-fixture-zzz-rust-crate');
  mkdirSync(crateStage, { recursive: true });
  const cratePackageDir = join(rustDir, 'target', 'package');
  for (const entry of readdirSync(cratePackageDir)) {
    if (entry.endsWith('.crate')) {
      cpSync(join(cratePackageDir, entry), join(crateStage, entry));
    }
  }

  // pypi sdist: `python -m build --sdist` drops .tar.gz into dist/.
  const pyDir = join(repo.cwd, 'python');
  execFileSync('python', ['-m', 'build', '--sdist', '--outdir', 'dist'], {
    cwd: pyDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sdistStage = join(artifactsRoot, 'piot-fixture-zzz-python-sdist');
  mkdirSync(sdistStage, { recursive: true });
  const pyDist = join(pyDir, 'dist');
  for (const entry of readdirSync(pyDist)) {
    if (entry.endsWith('.tar.gz')) {
      cpSync(join(pyDist, entry), join(sdistStage, entry));
    }
  }
}

/* ---------------------------- internals ---------------------------- */

const PLACEHOLDER_FILENAMES = new Set([
  'putitoutthere.toml',
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
]);

function rewritePlaceholders(cwd: string, version: string): void {
  for (const path of walkManifests(cwd)) {
    const raw = readFileSync(path, 'utf8');
    if (raw.includes('__VERSION__')) {
      writeFileSync(path, raw.replaceAll('__VERSION__', version), 'utf8');
    }
  }
}

function* walkManifests(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkManifests(full);
    } else if (PLACEHOLDER_FILENAMES.has(entry)) {
      yield full;
    }
  }
}

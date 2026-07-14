/**
 * `piot verify` against the REAL registries — the e2e twin of
 * `tests/integration/verify.integration.test.ts`.
 *
 * Shells out to the built CLI (`node dist/cli-bin.js verify …`) pointed at
 * piot's own fixture packages, all published to the real registries via
 * **OIDC trusted publishers** by the CI e2e suite. So each must classify
 * `oidc` — read from public trust attribution with no secrets:
 *   crates.io  version.trustpub_data
 *   npm        provenance attestations endpoint
 *   PyPI       integrity/provenance endpoint
 * This is the tier that fails if a registry's real trust-signal shape
 * diverges from the mocked one.
 *
 * Red before the feature: `verify` is an unknown subcommand.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issues #403, #414.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const FIXTURE_CONFIG = join(
  fileURLToPath(import.meta.url),
  '..',
  'fixtures',
  'status',
  'putitoutthere.toml',
);

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

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
  repo = mkdtempSync(join(tmpdir(), 'piot-verify-e2e-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  cpSync(FIXTURE_CONFIG, join(repo, 'putitoutthere.toml'));
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

interface VerifyRow {
  package: string;
  version: string | null;
  posture: string;
}

describe('piot verify against live registries (#414)', () => {
  it('classifies every OIDC-published piot fixture as oidc', () => {
    const { code, stdout, stderr } = runCli(['verify', '--json', '--cwd', repo]);
    const rows = JSON.parse(stdout) as VerifyRow[];
    const byPkg = Object.fromEntries(rows.map((r) => [r.package, r]));

    for (const name of ['fixture-rust', 'fixture-npm', 'fixture-py']) {
      const row = byPkg[name]!;
      expect(
        row.posture,
        `${name} should be OIDC (published via trusted publisher). output:\n${stdout}\n${stderr}`,
      ).toBe('oidc');
      expect(row.version).toMatch(/^0\.0\.\d+$/);
    }
    expect(code).toBe(0);
  });
});

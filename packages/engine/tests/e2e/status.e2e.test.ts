/**
 * `piot status` against the REAL registries — the e2e twin of
 * `tests/integration/status.integration.test.ts`.
 *
 * Where the integration test imports the engine in-process and mocks the
 * registry HTTP (msw), this one **shells out to the built CLI**
 * (`node dist/cli-bin.js status …`) and hits crates.io / npm / PyPI for
 * real — pointed at piot's own stable fixture packages
 * (`piot-fixture-zzz-*`, published to the real registries by the CI e2e
 * suite; see tests/fixtures/README.md). Same scenario, same assertions —
 * but nothing is mocked, so this is the tier that fails if a registry's
 * real "latest" shape doesn't match what `latestVersion` parses. The
 * integration test, which mocks those shapes, cannot catch that.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issues #403, #406.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The actual published binary entry point — a real subprocess, not an
// in-process import. `pnpm test:e2e` builds it before this runs.
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

/** Shell out to the real CLI; capture exit code + stdout either way. */
function runCli(args: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString('utf8') ?? '');
    return { code: e.status ?? 1, stdout };
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-status-e2e-'));
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

interface Row {
  package: string;
  registry: string | null;
  registryUnreachable: boolean;
  state: string;
  drift: boolean;
}

describe('piot status against live registries (#403)', () => {
  it('fetches each package\'s real latest version and flags it published-but-untagged', () => {
    // No tags were created, so every package is live-on-registry but
    // untagged locally. The CLI must fetch a real latest version for each
    // piot fixture from the live registry and flag the drift.
    const { code, stdout } = runCli(['status', '--check', '--json', '--cwd', repo]);
    const rows = JSON.parse(stdout) as Row[];
    const byName = Object.fromEntries(rows.map((r) => [r.package, r]));

    for (const name of ['fixture-rust', 'fixture-npm', 'fixture-py']) {
      const row = byName[name]!;
      expect(row.registryUnreachable).toBe(false);
      // A real version came back from the live registry, in the fixture
      // suite's `0.0.{unix_seconds}` scheme — proof the field-shape parse
      // is correct against reality (the assertion the mocked integration
      // test structurally cannot make).
      expect(row.registry).toMatch(/^0\.0\.\d+$/);
      expect(row.state).toBe('published, untagged');
      expect(row.drift).toBe(true);
    }
    // `--check` turns the drift into a non-zero exit.
    expect(code).toBe(1);
  });
});

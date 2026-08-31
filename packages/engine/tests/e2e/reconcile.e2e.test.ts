/**
 * `piot reconcile` against the real CLI + real registries — the e2e twin
 * of `tests/integration/reconcile.integration.test.ts`.
 *
 * Where the integration test imports the engine in-process and mocks the
 * registry HTTP (msw), this one **shells out to the built CLI**
 * (`node dist/cli-bin.js reconcile …`) pointed at piot's own live fixture
 * packages, whose current versions are published with no local git tag.
 * reconcile reads the real latest version and backfills the tag.
 *
 * No publish, no auth, no build: reconcile only reads the registry and
 * writes a git tag. The throwaway repo has no `origin`, so the tag push
 * is warned-not-fatal (same as the publish-path auto-heal e2e) — the
 * local tag is the observable contract. With a single package there is
 * no sibling tag to borrow, so the tag lands at HEAD.
 *
 * The second scenario is #623's: a package whose registry version is
 * AHEAD of its newest tag. A delegated PyPI upload runs in the caller's
 * `pypi-publish` job, so the tag for the version it uploads has to be
 * backfilled after the fact — and in steady state the package already
 * carries the previous release's tag, so "no tags at all" never
 * describes it.
 *
 * ## Why these assertions are shaped this way (#665)
 *
 * Both tests used to read the registry's *latest-version pointer*
 * themselves and assert reconcile had landed on the same answer. Nothing
 * makes two independent reads of a mutable pointer agree: `e2e-fixture.yml`
 * publishes these fixtures on every PR, and PyPI serves that pointer with
 * `cache-control: max-age=900`, so for up to 15 minutes after an upload
 * one read can see the new version and the other the old one. That fired
 * on a docs-only PR (#663).
 *
 * So we assert what reconcile is actually contracted to do — *tag a
 * version that is really live* — using the version reconcile itself
 * reports (`--json`), then confirm that version against the registry's
 * **per-version** endpoint. A per-version resource is immutable once
 * published, so that read cannot skew. What the latest-version pointer
 * happened to say at any instant was never the contract.
 *
 * Red before the command exists: `reconcile` is an unknown subcommand.
 * Red before #623: the registry-ahead scenario heals nothing.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issues #403, #410,
 * #623, #665.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReconcileAction, ReconcileResult } from '../../src/reconcile-types.js';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const CRATE = 'piot-fixture-zzz-poly-rust';
const PYPI_PROJECT = 'piot-fixture-zzz-python-sdist';
const UA = 'piot-e2e-reconcile';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/**
 * Is this exact version published on crates.io? The per-version resource
 * is immutable once published, so unlike `newest_version` it returns the
 * same answer no matter when the two sides of the test read it (#665).
 */
async function cratesHasVersion(version: string): Promise<boolean> {
  const url = `https://crates.io/api/v1/crates/${CRATE}/${encodeURIComponent(version)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  return res.status === 200;
}

/** PyPI's immutable per-version resource. Same reasoning as above. */
async function pypiHasVersion(version: string): Promise<boolean> {
  const url = `https://pypi.org/pypi/${PYPI_PROJECT}/${encodeURIComponent(version)}/json`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  return res.status === 200;
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

type Run = { code: number; stdout: string; stderr: string };

function out(r: Run): string {
  return `reconcile output:\n${r.stdout}\n${r.stderr}`;
}

/** The logger writes to stderr, so `--json` leaves stdout pure JSON. */
function actionsFrom(r: Run): ReconcileAction[] {
  try {
    return (JSON.parse(r.stdout) as ReconcileResult).actions;
  } catch {
    throw new Error(`reconcile --json emitted unparseable stdout.\n${out(r)}`);
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
    // First run: the crate is live on crates.io with no local tag, so
    // reconcile must create one (at HEAD — no sibling package to borrow
    // a commit from).
    const first = runCli(['reconcile', '--json', '--cwd', repo]);
    expect(first.code, out(first)).toBe(0);

    const actions = actionsFrom(first);
    expect(actions.map((a) => a.package), out(first)).toEqual(['fixture-rust']);
    const action = actions[0]!;
    expect(action, out(first)).toMatchObject({ kind: 'crates', source: 'head', created: true });

    // The version it tagged must be one crates.io actually carries —
    // reconcile may not invent a version or tag a yanked-away one.
    expect(await cratesHasVersion(action.version), `not on crates.io: ${action.version}`).toBe(true);

    // …and the tag it reported must be the tag on disk. Report and effect
    // agreeing is the part a caller's `pypi-publish` job depends on.
    expect(action.tag).toBe(`fixture-rust-v${action.version}`);
    expect(git(['tag', '-l']).split('\n'), out(first)).toContain(action.tag);

    // Second run: that tag already exists — reconcile is a clean no-op for
    // it, not an error, and leaves exactly one such tag. Asserted on this
    // tag rather than on an empty action list, because a fixture publish
    // landing between the two runs may legitimately add a different one.
    const second = runCli(['reconcile', '--json', '--cwd', repo]);
    expect(second.code, out(second)).toBe(0);
    expect(actionsFrom(second).map((a) => a.tag), out(second)).not.toContain(action.tag);
    const same = git(['tag', '-l'])
      .split('\n')
      .filter((t) => t === action.tag);
    expect(same).toHaveLength(1);
  });
});

describe('piot reconcile against pypi.org: registry ahead of the newest tag (#623)', () => {
  it('backfills the tag for the live version when an older tag already exists', async () => {
    // A pypi-only repo whose previous release (0.0.1) is tagged, while
    // the version actually on PyPI — uploaded by a caller-side
    // `pypi-publish` job — is not. reconcile reads the live version and
    // cuts the tag that upload never got.
    writeFileSync(
      join(repo, 'putitoutthere.toml'),
      `[putitoutthere]
version = 1

[[package]]
name  = "fixture-py"
kind  = "pypi"
pypi  = "${PYPI_PROJECT}"
path  = "packages/py"
globs = ["packages/py/**"]
`,
      'utf8',
    );
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'pypi config']);
    git(['tag', '-a', '-m', 'fixture-py-v0.0.1', 'fixture-py-v0.0.1']);

    const res = runCli(['reconcile', '--json', '--cwd', repo]);
    expect(res.code, out(res)).toBe(0);

    const actions = actionsFrom(res);
    expect(actions.map((a) => a.package), out(res)).toEqual(['fixture-py']);
    const action = actions[0]!;
    expect(action, out(res)).toMatchObject({ kind: 'pypi', source: 'head', created: true });

    // The registry-ahead heal fired: the version tagged is not the 0.0.1
    // the repo already carried, which is what distinguishes #623 from the
    // "no tags at all" case the crates scenario covers.
    expect(action.version, out(res)).not.toBe('0.0.1');
    expect(action.tag).toBe(`fixture-py-v${action.version}`);

    // And it is a version PyPI really has, not whatever a stale
    // latest-version pointer happened to name.
    expect(await pypiHasVersion(action.version), `not on PyPI: ${action.version}`).toBe(true);

    const tags = git(['tag', '-l']).split('\n');
    expect(tags, out(res)).toContain(action.tag);
    // The pre-existing older tag is left alone.
    expect(tags, out(res)).toContain('fixture-py-v0.0.1');
  });
});

/**
 * The `pypi-tag` job must tag what the upload shipped, and must never
 * report "nothing to do" for a registry it could not read (#694).
 *
 * `agent-transcript-viewer 0.0.0` reached PyPI and never got its tag.
 * Twice. `pypi-tag` ran ~4s after the upload step finished and reported
 * `{"ok":true,"dryRun":false,"actions":[]}` — success, no tag, no
 * warning. Running the same command by hand minutes later produced the
 * action.
 *
 * Two distinct holes, both exercised here:
 *
 * 1. **Discovery cannot see a fresh first publish at all.** Bare
 *    `reconcile` reads PyPI's project pointer (`GET /pypi/{name}/json`),
 *    and for a project whose first release has not propagated that
 *    endpoint returns **404** — which `pypi.latestVersion` maps to
 *    `null`, i.e. *exactly* the permanent, correct answer for a package
 *    that was never released. There is no information in that read to
 *    distinguish the two, so no amount of retrying it can fix this: the
 *    publish state has to come from the run that performed the publish.
 *    `reconcile --expect` (#666) already confirms a caller-asserted
 *    `name@version` against the IMMUTABLE per-version endpoint — but
 *    nothing wires it: `action.yml` has no `expect` input, so the
 *    surface `pypi-tag.yml` actually invokes cannot ask for it. This
 *    tier drives that surface — `main()` from `src/action.ts`, the same
 *    adapter `uses: thekevinscott/putitoutthere@v0` runs — with the
 *    release job's `delegated_packages` JSON as its input.
 *
 * 2. **An unreadable registry is reported as nothing to do.** The
 *    discovery loop skips `registryUnreachable` rows and still exits
 *    `ok: true, actions: []`. "I could not read the registry" and
 *    "every live version already has its tag" are different facts and
 *    must not share an output.
 *
 * Only the registry HTTP boundary is mocked (msw); config, tags, handler
 * dispatch, the adapter's argv shaping, and the git tag writes are real.
 * In-process twin of `tests/e2e/pypi-tag-race.e2e.test.ts`.
 *
 * Issue #694.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../../src/action.js';
import { run } from '../../src/cli.js';

/* --------------------------- registry mocks --------------------------- *
 * The two PyPI reads reconcile can make, deliberately allowed to
 * disagree — that disagreement IS the bug:
 *
 *   GET /pypi/{name}/json            -> info.version  (mutable project
 *                                       pointer; 404 while a first
 *                                       release propagates, and also 404
 *                                       forever for a project that does
 *                                       not exist)
 *   GET /pypi/{name}/{version}/json  -> 200 | 404     (immutable; names
 *                                       one exact version)
 *
 * `pointerStatus` forces a non-404 failure on the pointer read alone, so
 * a test can produce a genuinely unreadable PyPI without touching the
 * per-version endpoint or the sibling registries.
 */
const pointer = new Map<string, string>();
const published = new Map<string, Set<string>>();
let pointerStatus: number | null = null;

const server = setupServer(
  http.get('https://pypi.org/pypi/:name/json', ({ params }) => {
    if (pointerStatus !== null) {
      return new HttpResponse('{"message":"upstream"}', { status: pointerStatus });
    }
    const v = pointer.get(String(params.name));
    return v === undefined
      ? new HttpResponse('{"message":"Not Found"}', { status: 404 })
      : HttpResponse.json({ info: { version: v } });
  }),
  http.get('https://pypi.org/pypi/:name/:version/json', ({ params }) =>
    (published.get(String(params.name))?.has(String(params.version)) ?? false)
      ? HttpResponse.json({ info: { version: String(params.version) } })
      : new HttpResponse('{"message":"Not Found"}', { status: 404 }),
  ),
  // The fixture config is polyglot; the crates/npm siblings are simply
  // never published in these scenarios. A 404 is an answer — "not
  // published" — not an unreachable registry.
  http.get('https://crates.io/api/v1/crates/:name', () =>
    new HttpResponse('{"errors":[{"detail":"Not Found"}]}', { status: 404 }),
  ),
  http.get('https://registry.npmjs.org/:name', () => new HttpResponse('{}', { status: 404 })),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/* ------------------------------- git repo ------------------------------- */

let repo: string;
let remote: string;
const stdoutChunks: string[] = [];
const stderrChunks: string[] = [];

function gitInRepo(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

function tags(): string[] {
  return gitInRepo(['tag', '-l']).split('\n').filter(Boolean);
}

function output(): string {
  return `${stdoutChunks.join('')}\n${stderrChunks.join('')}`;
}

/** Lines the CLI wrote to stdout, split for per-line assertions. */
function stdoutLines(): string[] {
  return stdoutChunks.join('').split('\n');
}

/**
 * The reconcile JSON document, picked out of stdout by line. Workflow
 * annotations share the stream, so stdout as a whole is not JSON.
 */
function jsonResult(): Record<string, unknown> {
  const line = stdoutLines().find((l) => l.startsWith('{'));
  if (line === undefined) {throw new Error(`no JSON line in stdout:\n${output()}`);}
  return JSON.parse(line) as Record<string, unknown>;
}

// Shared with the `status` / `reconcile` fixtures: a Rust crate wrapped
// by an npm and a PyPI package (`mycrate-py`).
const FIXTURE_CONFIG = join(
  fileURLToPath(import.meta.url),
  '..',
  'fixtures',
  'status',
  'putitoutthere.toml',
);

function writeConfig(): void {
  cpSync(FIXTURE_CONFIG, join(repo, 'putitoutthere.toml'));
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'config']);
}

/**
 * Invoke the adapter exactly as `pypi-tag.yml`'s step does: `command:
 * reconcile`, the checkout directory, and (once wired) the release job's
 * `delegated_packages` output. Returns the exit code the adapter
 * surfaced.
 */
async function runAction(inputs: Record<string, string>): Promise<number> {
  process.env.INPUT_COMMAND = 'reconcile';
  process.env.INPUT_WORKING_DIRECTORY = repo;
  for (const [k, v] of Object.entries(inputs)) {
    process.env[`INPUT_${k.toUpperCase()}`] = v;
  }
  try {
    await main();
  } catch (err) {
    const m = /^exit:(\d+)$/.exec((err as Error).message);
    if (!m) {throw err;}
    return Number(m[1]);
  }
  throw new Error('action returned without exiting');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-pypi-tag-race-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  gitInRepo(['config', 'tag.gpgsign', 'false']);
  // ensureTag (#717) now requires a real push to succeed before it
  // considers a release tagged; give it a real, local `origin` to push to.
  remote = mkdtempSync(join(tmpdir(), 'piot-pypi-tag-race-remote-'));
  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote });
  gitInRepo(['remote', 'add', 'origin', remote]);

  stdoutChunks.length = 0;
  stderrChunks.length = 0;
  // The callbacks must fire: the adapter awaits `flushStdio` before every
  // exit, so a mock that only returns `true` would park `main()` forever.
  vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown,
    cb?: () => void,
  ) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    cb?.();
    return true;
  }) as unknown as typeof process.stdout.write);
  vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: unknown,
    cb?: () => void,
  ) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
    cb?.();
    return true;
  }) as unknown as typeof process.stderr.write);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as typeof process.exit);
});

afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  pointer.clear();
  published.clear();
  pointerStatus = null;
  delete process.env.INPUT_COMMAND;
  delete process.env.INPUT_WORKING_DIRECTORY;
  delete process.env.INPUT_EXPECT;
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

describe('pypi-tag tags what the upload shipped, not what discovery can see (#694)', () => {
  /**
   * The exact shape of the reported failure: `mycrate-py` has never been
   * released, the upload just put 0.0.0 on PyPI, and the project pointer
   * has not propagated — so it 404s, indistinguishably from a project
   * that does not exist.
   */
  function firstPublishNotYetPropagated(): void {
    writeConfig();
    published.set('mycrate-py', new Set(['0.0.0']));
    // pointer deliberately left empty => 404, as for an unknown project.
  }

  it('cuts the tag for a first publish the project pointer cannot see yet', async () => {
    firstPublishNotYetPropagated();

    // Control, and the bug verbatim: the adapter with no expectation
    // discovers nothing, reports success, and cuts no tag.
    const discovery = await runAction({});
    expect(discovery, output()).toBe(0);
    expect(tags(), output()).toEqual([]);

    // Told what the run shipped — the release job's `delegated_packages`
    // output, forwarded verbatim — the same adapter confirms 0.0.0 against
    // the immutable per-version endpoint and cuts its tag.
    const code = await runAction({
      expect: '[{"name":"mycrate-py","version":"0.0.0","tag":"mycrate-py-v0.0.0"}]',
    });

    expect(tags(), output()).toEqual(['mycrate-py-v0.0.0']);
    expect(code, output()).toBe(0);
  });

  it('fails the job when the upload it was told about is not on the registry', async () => {
    // The upload silently uploaded nothing. Reporting success here is
    // what #694 is about; the job must go red instead of cutting a tag
    // for a release that did not happen.
    writeConfig();

    const code = await runAction({ expect: 'mycrate-py@0.0.0' });

    expect(code, output()).not.toBe(0);
    expect(output()).toContain('mycrate-py');
    expect(output()).toContain('0.0.0');
    expect(tags(), output()).toEqual([]);
  });
});

describe('reconcile does not report an unreadable registry as nothing to do (#694)', () => {
  /**
   * 0.0.1 shipped and is tagged; 0.0.2 was just uploaded and is live —
   * but the project pointer is answering 5xx, so discovery cannot see
   * either. The row is skipped, and today that is invisible.
   */
  function pointerUnreadable(): void {
    writeConfig();
    gitInRepo(['tag', '-a', '-m', 'mycrate-py-v0.0.1', 'mycrate-py-v0.0.1']);
    published.set('mycrate-py', new Set(['0.0.1', '0.0.2']));
    pointer.set('mycrate-py', '0.0.2');
    pointerStatus = 503;
  }

  it('reports the skipped row in --json instead of an empty, successful result', async () => {
    pointerUnreadable();

    const code = await run(['node', 'piot', 'reconcile', '--json', '--cwd', repo]);

    expect(code, output()).toBe(0);
    const result = jsonResult();
    expect(result.actions, output()).toEqual([]);
    // Not `actions: []` and nothing else: the reason a tag may be missing
    // has to travel with the result. Only PyPI was unreadable — the
    // siblings answered 404, which is an answer.
    expect(result.skipped, output()).toEqual([
      { package: 'mycrate-py', kind: 'pypi', reason: 'registry-unreachable' },
    ]);
  });

  it('emits a workflow warning naming the package it could not decide', async () => {
    // A log line nobody greps is not an outcome. The annotation is what
    // puts "a tag may be missing" on the job summary.
    pointerUnreadable();

    await run(['node', 'piot', 'reconcile', '--json', '--cwd', repo]);

    const warnings = stdoutLines().filter((l) => l.startsWith('::warning'));
    expect(warnings, output()).toHaveLength(1);
    expect(warnings[0], output()).toContain('mycrate-py');
  });

  it('stays silent about a package that simply was never published', async () => {
    // The other reason a row is skipped. `unreleased` is the steady
    // state of every package a repo has not shipped yet; warning on it
    // would make the signal worthless.
    writeConfig();

    const code = await run(['node', 'piot', 'reconcile', '--json', '--cwd', repo]);

    expect(code, output()).toBe(0);
    expect(jsonResult().skipped, output()).toEqual([]);
    expect(stdoutChunks.join(''), output()).not.toContain('::warning');
  });
});

/**
 * npm moniker-rule name collision (#617) against the real CLI and the
 * real npm client — the e2e twin of the `npm: E403 name-too-similar`
 * block in `registry-auth.integration.test.ts`.
 *
 * Where the integration test hands the handler a canned stderr string,
 * this shells out to the built CLI (`node dist/cli-bin.js publish`), which
 * spawns the **real npm binary**, which renders the registry's 403 into
 * **its own** stderr — the exact text the engine has to parse. A mock of
 * `execFile` cannot catch a misread of npm's rendering; this can.
 *
 * The registry is local. It has to be: an unauthenticated
 * `PUT https://registry.npmjs.org/<name>` answers `{"error":"Not found"}`,
 * so the moniker rejection is unobservable without publish credentials for
 * a name that is genuinely blocked — and provoking one on npmjs.org means
 * a real authenticated publish attempt. The local server returns npmjs.org's
 * documented moniker body verbatim; everything downstream of it (npm's
 * error rendering, the CLI subprocess, config load, plan, preflight,
 * handler dispatch, and the live `npm view` idempotency probe against
 * registry.npmjs.org) is real and unmocked.
 *
 * Red before the fix: the CLI dumps npm's stderr under a generic
 * "npm publish failed" and offers no diagnosis, so an operator reads the
 * 403 as a credentials problem — which is how #617 burned four runs and
 * two fresh tokens on a name no token could ever create.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issue #617.
 */

import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

// The name under test and the name that blocks it: the same string with
// and without punctuation, which is exactly what npm's moniker rule
// collapses together. Both sit in piot's own `piot-fixture-zzz-*` naming
// space and neither is on registry.npmjs.org, so the handler's `npm view`
// idempotency probe — a real, unmocked GET against the live registry —
// correctly reports "never published" and the run reaches the publish
// attempt this test is about.
// Stand-in credential for both the pre-flight and npm's `.npmrc`. Low
// Shannon entropy on purpose — see `runCli`.
const NOT_A_TOKEN = 'not-a-token';
const NAME = 'piotfixturezzzmoniker';
const BLOCKED_BY = 'piot-fixture-zzz-moniker';
const VERSION = '0.0.1';

let repo: string;
let server: Server;
let registry: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/**
 * A stand-in for registry.npmjs.org that refuses to create the name, with
 * the body npmjs.org sends for a moniker block. GET 404s so npm treats the
 * package as new; PUT is the publish.
 */
function startRegistry(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      if (req.method === 'PUT') {
        req.resume();
        req.on('end', () => {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error:
                `Package name too similar to existing package ${BLOCKED_BY}; ` +
                `try renaming your package to '@piot-fixtures/${NAME}' instead.`,
            }),
          );
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ server: srv, url: `http://127.0.0.1:${port}/` });
    });
  });
}

/**
 * Shell out to the real CLI; capture exit + stdout/stderr either way.
 *
 * Async on purpose. The stand-in registry runs on this thread's event
 * loop, so a blocking `execFileSync` here would deadlock: npm's PUT could
 * never be served while the parent sat waiting for npm to exit.
 */
async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // A throwaway token clears the auth pre-flight and rides through to npm,
  // which sends it to the local registry that never checks it. The point of
  // the test is that a perfectly good token changes nothing here.
  //
  // Kept deliberately low-entropy: the secret-scan gate's generic-api-key
  // rule fires on any high-entropy string sitting next to the word "token",
  // and a placeholder is not worth an allowlist entry.
  const env = {
    ...process.env,
    PIOT_NPM_REGISTRY: registry,
    NODE_AUTH_TOKEN: NOT_A_TOKEN,
  };
  // Drop the GitHub vars so the repo-visibility / URL-match pre-flight
  // no-ops (it skips when GITHUB_REPOSITORY is unset).
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_TOKEN;
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], { encoding: 'utf8', env }, (err, stdout, stderr) => {
      const code = typeof (err as { code?: unknown } | null)?.code === 'number'
        ? (err as unknown as { code: number }).code
        : err
          ? 1
          : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

beforeEach(async () => {
  const started = await startRegistry();
  server = started.server;
  registry = started.url;

  repo = mkdtempSync(join(tmpdir(), 'piot-moniker-e2e-'));
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
name  = "${NAME}"
kind  = "npm"
path  = "packages/js"
globs = ["packages/js/**"]
`,
  );
  writeRepoFile(
    'packages/js/package.json',
    JSON.stringify(
      {
        name: NAME,
        version: '0.0.0',
        repository: { type: 'git', url: 'git+https://github.com/thekevinscott/putitoutthere.git' },
      },
      null,
      2,
    ),
  );
  writeRepoFile('packages/js/index.js', 'module.exports = {};\n');
  // npm refuses to publish without an auth entry for the target registry;
  // the local server never checks it.
  writeRepoFile(
    'packages/js/.npmrc',
    `registry=${registry}\n${registry.replace(/^https?:/, '')}:_authToken=${NOT_A_TOKEN}\n`,
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: initial\n\nrelease: patch']);
});

afterEach(async () => {
  rmSync(repo, { recursive: true, force: true });
  // npm's undici agent keeps its socket alive after the 403, and a bare
  // `close()` waits for it — the run would hang past the suite timeout.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => { resolve(); }));
});

describe('npm publish refused for an unregistrable name (#617)', () => {
  it('diagnoses the name, names the remedy, and stays greppable', async () => {
    const { code, stdout, stderr } = await runCli([
      'publish', '--release-packages', `${NAME}@${VERSION}`, '--cwd', repo,
    ]);
    const out = `${stdout}\n${stderr}`;

    expect(code, out).not.toBe(0);
    // Greppable code, so a run log can be fingerprinted without prose.
    expect(out).toContain('PIOT_NPM_NAME_TOO_SIMILAR');
    // The remedy is a rename or a scope — not a credential.
    expect(out).toMatch(/rename/i);
    expect(out).toMatch(/scope/i);
    // npm's own line survives: it is the only place the blocking package
    // is named, and losing it is half of what made #617 hard to diagnose.
    expect(out).toContain(`Package name too similar to existing package ${BLOCKED_BY}`);
  });

  it('reports what actually ran: npm\'s exit code and argv, not placeholders', async () => {
    // The other half of #617. The failure record the operator reads was
    // built from the engine's own rendered sentence with `command: ""` and
    // `exitCode: -1` — a dump that says a publish failed without saying
    // what ran or how it ended. Asserted here rather than in the summary
    // markdown because this is the line a run log actually carries.
    const { stdout, stderr } = await runCli([
      'publish', '--release-packages', `${NAME}@${VERSION}`, '--cwd', repo,
    ]);
    const out = `${stdout}\n${stderr}`;

    expect(out).toMatch(/"command":"npm publish [^"]+"/);
    // npm's real exit status. Pinned as "some non-zero" rather than a
    // literal so an npm CLI that renumbers its exits doesn't fail this.
    expect(out).toMatch(/"exitCode":[1-9]\d*/);
  });
});

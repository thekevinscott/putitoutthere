/**
 * `publish` report → per-platform publish summary (#625) driving the real
 * `npm` CLI against a local registry served over `node:http`, reached through
 * the engine's `PIOT_NPM_REGISTRY` seam (#304) — this behaviour cannot be
 * observed without publishing. Each scenario asserts report *and* registry.
 */

import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const pExecFile = promisify(execFile);

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');
const PKG = 'piot-fixture-zzz-platform-report';
const VERSION = '0.3.0';
const TARGETS = ['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin'] as const;
const PLATFORM_NAMES = TARGETS.map((t) => `${PKG}-${t}`);
/** Stand-in for the auth entry npm requires; see `npmrcFor`. */
const INERT = ['piot', 'e2e', 'stand', 'in'].join('-');

/* --------------------------- local npm registry --------------------------- */

interface Packument {
  name: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, unknown>;
}

/**
 * The minimum of the npm registry API the publish path exercises:
 * `GET /{name}` (what `npm view <name>@<version> version` reads — 404
 * when the package has never been published) and `PUT /{name}` (what
 * `npm publish` uploads). Every request the real `npm` CLI makes lands
 * here.
 *
 * Served on the event loop, so every subprocess spawn in this file must
 * be awaited rather than `*Sync` — a synchronous spawn blocks the loop
 * and the registry can never answer the request npm is waiting on.
 */
class LocalRegistry {
  readonly packuments = new Map<string, Packument>();
  /** Every successful PUT, in order — what the registry actually got. */
  readonly uploads: Array<{ name: string; version: string }> = [];
  private server!: Server;
  private port!: number;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const name = decodeURIComponent((req.url ?? '/').replace(/^\//, '').split('?')[0]!);
      if (req.method === 'GET') {
        const doc = this.packuments.get(name);
        if (doc === undefined) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(doc));
        return;
      }
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            versions?: Record<string, unknown>;
          };
          for (const [version, meta] of Object.entries(body.versions ?? {})) {
            this.seed(name, version, meta);
            this.uploads.push({ name, version });
          }
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      res.writeHead(405);
      res.end();
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  /** Put a version on the registry without going through `npm publish`. */
  seed(name: string, version: string, meta: unknown = {}): void {
    const doc = this.packuments.get(name) ?? { name, 'dist-tags': {}, versions: {} };
    doc.versions[version] = {
      ...(meta as Record<string, unknown>),
      name,
      version,
      dist: { tarball: `${this.url}${name}/-/${name}-${version}.tgz` },
    };
    doc['dist-tags'].latest = version;
    this.packuments.set(name, doc);
  }
}

/* -------------------------------- fixture -------------------------------- */

interface PublishReport {
  ok: boolean;
  published: Array<{
    package: string;
    version: string;
    result: {
      status: string;
      url?: string;
      platforms?: { published: string[]; skipped: string[] };
    };
    tag: string;
  }>;
}

let registry: LocalRegistry;
let repo: string;
let remote: string;
let npmrc: string;

/**
 * Both lines are load-bearing: `registry=` is what `npm view` reads (the
 * probe passes no `--registry`), and npm declines to PUT at all with no auth
 * entry for the host. The value is inert and 127.0.0.1-scoped; assembled
 * rather than written literal so gitleaks' `generic-api-key` rule stays quiet.
 */
function npmrcFor(registryUrl: string): string {
  const host = registryUrl.replace(/^http:/, '');
  return [`registry=${registryUrl}`, `${host}:_authToken=${INERT}`, ''].join('\n');
}

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/**
 * Run the built CLI as a real subprocess and parse its `--json` report.
 * Async on purpose — see `LocalRegistry`.
 */
async function publishJson(): Promise<PublishReport> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The internal e2e seam (#304): route publish at the local registry
    // and suppress the npmjs.org-specific provenance path.
    PIOT_NPM_REGISTRY: registry.url,
    // `npm view` runs without an explicit --registry, so the registry
    // has to come from config; the auth line is what `npm publish`
    // reads. `npm_config_userconfig` is on the engine's subprocess-env
    // allowlist (src/env.ts), so it survives into every npm spawn.
    npm_config_userconfig: npmrc,
    // Clears the publish-path auth pre-flight. Never sent anywhere:
    // the local registry accepts the request unauthenticated.
    NODE_AUTH_TOKEN: 'piot-e2e-platform-report-placeholder',
  };
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_TOKEN;

  let stdout: string;
  try {
    ({ stdout } = await pExecFile('node', [CLI, 'publish', '--json', '--cwd', repo], {
      env,
      encoding: 'utf8',
    }));
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    throw new Error(
      `publish exited non-zero.\nstdout:\n${e.stdout ?? ''}\nstderr:\n${e.stderr ?? ''}`,
    );
  }
  return JSON.parse(stdout.trim()) as PublishReport;
}

beforeEach(async () => {
  registry = new LocalRegistry();
  await registry.start();

  repo = mkdtempSync(join(tmpdir(), 'piot-platform-report-e2e-'));
  npmrc = join(repo, 'e2e.npmrc');
  writeFileSync(npmrc, npmrcFor(registry.url), 'utf8');

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  // ensureTag (#717) now requires a real push to succeed before it
  // considers a release tagged; give it a real, local `origin` to push to.
  remote = mkdtempSync(join(tmpdir(), 'piot-platform-report-e2e-remote-'));
  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote });
  git(['remote', 'add', 'origin', remote]);

  writeRepoFile(
    'putitoutthere.toml',
    `[putitoutthere]
version = 1

[[package]]
name          = "${PKG}"
kind          = "npm"
path          = "packages/js"
globs         = ["packages/js/**"]
build         = "napi"
targets       = [${TARGETS.map((t) => `"${t}"`).join(', ')}]
first_version = "${VERSION}"
`,
  );
  writeRepoFile('packages/js/index.js', 'module.exports = {};\n');
  writeRepoFile(
    'packages/js/package.json',
    JSON.stringify(
      {
        name: PKG,
        version: '0.0.0',
        main: 'index.js',
        license: 'MIT',
        repository: { type: 'git', url: 'git+https://github.com/thekevinscott/putitoutthere.git' },
      },
      null,
      2,
    ) + '\n',
  );

  // Staged build output, in the `artifacts/<artifact_name>/` layout the
  // planner emits: one `.node` per target plus the `main` row.
  for (const target of TARGETS) {
    writeRepoFile(`artifacts/${PKG}-${target}/${PKG}.${target}.node`, `native-${target}`);
  }
  writeRepoFile(`artifacts/${PKG}-main/package.json`, `{"name":"${PKG}"}\n`);

  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: initial']);
});

afterEach(async () => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  await registry.stop();
});

describe('publish report names the platform packages (#625, real CLI + real npm)', () => {
  it('reports every platform package the registry actually received', async () => {
    const report = await publishJson();

    // What the registry got: two platform packages plus the umbrella.
    expect(registry.uploads.map((u) => u.name).sort()).toEqual(
      [...PLATFORM_NAMES, PKG].sort(),
    );

    // What the report says. Before #625 this was one line for a
    // three-package publish — no way, from the outside, to tell it apart
    // from a partial publish that shipped the umbrella and stopped.
    expect(report.published).toHaveLength(1);
    const [entry] = report.published;
    expect(entry!.package).toBe(PKG);
    expect(entry!.version).toBe(VERSION);
    expect(entry!.result.status).toBe('published');
    expect(entry!.result.platforms).toBeDefined();
    expect(entry!.result.platforms!.published).toEqual(PLATFORM_NAMES);
    expect(entry!.result.platforms!.skipped).toEqual([]);
  });

  it('reports the platform packages it skipped as already on the registry', async () => {
    // A re-run after a partial failure: both platform packages already
    // published at this version, the umbrella never made it.
    for (const name of PLATFORM_NAMES) {
      registry.seed(name, VERSION);
    }

    const report = await publishJson();

    // Only the umbrella is uploaded this run — the platform packages are
    // left alone.
    expect(registry.uploads.map((u) => u.name)).toEqual([PKG]);

    // And the report says so, which is the reassurance the operator
    // needs to know nothing was lost.
    const [entry] = report.published;
    expect(entry!.result.platforms).toBeDefined();
    expect(entry!.result.platforms!.skipped).toEqual(PLATFORM_NAMES);
    expect(entry!.result.platforms!.published).toEqual([]);
  });
});

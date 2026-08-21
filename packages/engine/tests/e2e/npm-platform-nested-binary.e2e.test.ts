/**
 * Nested bundled-cli artifacts, end-to-end through the real CLI and the
 * real `npm` CLI — the e2e twin of
 * `npm-platform-nested-binary.integration.test.ts` (#626).
 *
 * A consumer's build step may stage the cross-compiled binary either flat
 * (`artifacts/<pkg>-<triple>/<bin>`) or nested under a subdirectory
 * (`artifacts/<pkg>-<triple>/bin/<bin>`). Both layouts clear the
 * completeness check — it lists files recursively — so both reach
 * `synthesizePlatformPackage`. The nested one used to synthesize
 * `"main": "bin"` (a *directory*) and, worse, land the #365 executable-bit
 * restore on that directory instead of on the binary, so the published
 * tarball carried the binary at 0644. Live casualty:
 * `@agent-transcripts/x86_64-unknown-linux-gnu@0.0.1`.
 *
 * Where the integration twin mocks the npm subprocess and inspects the
 * staging directory, this shells out to the built CLI (`node
 * dist/cli-bin.js publish`) and lets the real `npm` CLI pack and PUT the
 * tarball. The assertion reads the bytes npm actually published — the
 * exact artifact a consumer downloads. That is the fidelity a mock cannot
 * offer: `npm pack`'s `portable: true` mode is what turns a staged file's
 * executable bit into 0755-vs-0644 in the tarball, and no mocked
 * subprocess reproduces it.
 *
 * The registry is a local, in-process HTTP stub rather than npmjs.org:
 * this scenario *must* publish to be observable, and publishing to real
 * npm on every PR is not an option. Same trade the fixture suite makes
 * with Verdaccio for its `-first-publish` rows. Everything else — the
 * engine, the npm CLI, the filesystem, the tarball — is real.
 *
 * Run via `pnpm test:e2e` (which builds `dist/` first). Issue #626.
 */

import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const CLI = join(fileURLToPath(import.meta.url), '..', '..', '..', 'dist', 'cli-bin.js');

const PKG = 'piot-e2e-nested-cli';
const BIN = 'piot-e2e-nested';
const TRIPLE = 'linux-x64-gnu';
const PLATFORM_PKG = `${PKG}-${TRIPLE}`;
const VERSION = '0.0.1';

let repo: string;
let registry: Registry;

/* --------------------------- registry stub --------------------------- */

interface Registry {
  url: string;
  /** Every publish PUT body, in arrival order. */
  puts: string[];
  server: Server;
}

/** Minimal npm registry: 404 on every read (nothing is published yet),
 *  201 on every publish PUT, body retained for inspection. */
async function startRegistry(): Promise<Registry> {
  const puts: string[] = [];
  const server = createServer((req, res) => {
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        puts.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, puts, server };
}

/* ------------------------------ tar bits ------------------------------ */

interface TarEntry {
  name: string;
  /** The mode recorded in the ustar header — what a consumer's `npm
   *  install` writes to disk, before any local umask. */
  mode: number;
  content: Buffer;
}

/** Walk a tar's 512-byte ustar headers. Reading the archived mode beats
 *  extracting and stat-ing: extraction filters modes through the local
 *  umask, the header does not. */
function tarEntries(tar: Buffer): TarEntry[] {
  const field = (off: number, len: number): string =>
    tar.toString('utf8', off, off + len).replace(/\0.*$/s, '').trim();
  const out: TarEntry[] = [];
  for (let off = 0; off + 512 <= tar.length; ) {
    const name = field(off, 100);
    if (name === '') {break;} // the trailing zero blocks
    const mode = parseInt(field(off + 100, 8), 8);
    const size = parseInt(field(off + 124, 12), 8);
    out.push({ name, mode, content: tar.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** The tarball npm PUT for `name`, unpacked into its tar entries. */
function publishedTarball(name: string): TarEntry[] {
  const doc = registry.puts
    .map((body) => JSON.parse(body) as {
      name: string;
      _attachments: Record<string, { data: string }>;
    })
    .find((d) => d.name === name);
  if (doc === undefined) {
    throw new Error(
      `no publish PUT for ${name}; saw: ${registry.puts
        .map((b) => (JSON.parse(b) as { name: string }).name)
        .join(', ')}`,
    );
  }
  const attachment = Object.values(doc._attachments)[0]!;
  return tarEntries(gunzipSync(Buffer.from(attachment.data, 'base64')));
}

/* ------------------------------- fixture ------------------------------ */

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function writeRepoFile(rel: string, body: string): void {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

/** Shell out to the real CLI; capture exit + stdout/stderr either way.
 *
 *  Async on purpose: the registry stub above serves from this same
 *  process, so a blocking `execFileSync` would deadlock — npm's GET
 *  would sit in the socket queue behind the very call waiting on it. */
async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = {
    ...process.env,
    // The auth pre-flight wants a token; the registry stub wants none.
    NODE_AUTH_TOKEN: 'piot-e2e-nested-placeholder',
    // Point npm — both the `npm view` probes and the publish PUTs — at the
    // stub. `NPM_CONFIG_USERCONFIG` is on the engine's subprocess-env
    // allowlist (src/env.ts), so it survives the minimal-env spawn.
    NPM_CONFIG_USERCONFIG: join(repo, 'e2e.npmrc'),
  };
  // Unset so the repo-URL-match and repo-visibility pre-flights no-op
  // (they skip when GITHUB_REPOSITORY is absent) and so no OIDC is
  // detected — `--provenance` would demand a real sigstore round-trip.
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_TOKEN;
  delete env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI, ...args], { encoding: 'utf8', env });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

beforeEach(async () => {
  registry = await startRegistry();
  repo = mkdtempSync(join(tmpdir(), 'piot-nested-cli-e2e-'));
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
name    = "${PKG}"
kind    = "npm"
path    = "packages/cli"
globs   = ["packages/cli/**"]
build   = "bundled-cli"
targets = ["${TRIPLE}"]
`,
  );
  writeRepoFile(
    'packages/cli/package.json',
    JSON.stringify(
      {
        name: PKG,
        version: '0.0.0',
        license: 'MIT',
        repository: { type: 'git', url: 'git+https://github.com/thekevinscott/putitoutthere.git' },
        bin: { [BIN]: 'bin/launcher.js' },
      },
      null,
      2,
    ),
  );
  writeRepoFile('packages/cli/bin/launcher.js', '#!/usr/bin/env node\n');
  writeRepoFile(
    'e2e.npmrc',
    `registry=${registry.url}\n${registry.url.replace(/^http:/, '')}:_authToken=piot-e2e\n`,
  );

  // The main row's artifact — a bundled-cli plan always emits one.
  writeRepoFile(`artifacts/${PKG}-main/package.json`, '{}\n');

  // The per-target artifact, with the binary NESTED under `bin/` — the
  // layout #626 is about. 0644 mirrors what the Actions artifact
  // upload/download boundary leaves behind (#365).
  writeRepoFile(`artifacts/${PLATFORM_PKG}/bin/${BIN}`, '#!/bin/sh\necho nested\n');
  chmodSync(join(repo, 'artifacts', PLATFORM_PKG, 'bin', BIN), 0o644);

  git(['add', '-A']);
  git(['commit', '-q', '-m', 'config']);
});

afterEach(async () => {
  rmSync(repo, { recursive: true, force: true });
  await new Promise<void>((resolve) => registry.server.close(() => resolve()));
});

describe('bundled-cli platform publish with a nested binary (#626)', () => {
  it('publishes a tarball whose `main` names the binary, not its directory', async () => {
    const { stdout, stderr } = await runCli([
      'publish', '--release-packages', `${PKG}@${VERSION}`, '--cwd', repo,
    ]);

    const manifest = publishedTarball(PLATFORM_PKG).find(
      (e) => e.name === 'package/package.json',
    );
    const main = (JSON.parse(manifest!.content.toString('utf8')) as { main: string }).main;
    expect(main, `publish output:\n${stdout}\n${stderr}`).toBe(`bin/${BIN}`);
  });

  it('publishes the nested binary with its executable bit restored', async () => {
    const { stdout, stderr } = await runCli([
      'publish', '--release-packages', `${PKG}@${VERSION}`, '--cwd', repo,
    ]);

    // npm packs with `portable: true`, which collapses each file's mode to
    // 0755 or 0644 by its executable bit — so the archived mode is exactly
    // the #365 contract, observed on the published bytes.
    const binary = publishedTarball(PLATFORM_PKG).find(
      (e) => e.name === `package/bin/${BIN}`,
    );
    expect(binary, `publish output:\n${stdout}\n${stderr}`).toBeDefined();
    expect(binary!.mode & 0o111, `mode was 0${binary!.mode.toString(8)}`).not.toBe(0);
  });
});

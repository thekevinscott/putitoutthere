/**
 * `piot verify` — per-package publish/trust posture (#414, #403 slice 5).
 * The trust signal each registry exposes, confirmed against live fixtures:
 * crates.io `/api/v1/crates/{c}/{v}` -> `version.trustpub_data`; npm
 * `/-/npm/v1/attestations/{p}@{v}` -> 200/404; PyPI `/integrity/…/provenance`.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli.js';

const server = setupServer(
  // crates.io — latestVersion + trust attribution.
  http.get('https://crates.io/api/v1/crates/:name', ({ params }) =>
    String(params.name) === 'mycrate'
      ? HttpResponse.json({ crate: { newest_version: '0.0.1' } })
      : new HttpResponse('{}', { status: 404 }),
  ),
  http.get('https://crates.io/api/v1/crates/:name/:version', ({ params }) =>
    // Published via GitHub Trusted Publishing → trustpub_data present.
    HttpResponse.json({
      version: {
        crate: String(params.name),
        num: String(params.version),
        published_by: null,
        trustpub_data: { provider: 'github', repository: 'thekevinscott/putitoutthere' },
      },
    }),
  ),
  // npm — latestVersion + provenance attestations (200 = provenance).
  http.get('https://registry.npmjs.org/:name', ({ params }) =>
    String(params.name) === 'mycrate-npm'
      ? HttpResponse.json({ 'dist-tags': { latest: '0.0.1' }, versions: { '0.0.1': {} } })
      : new HttpResponse('{}', { status: 404 }),
  ),
  http.get('https://registry.npmjs.org/-/npm/v1/attestations/:pkg', () =>
    HttpResponse.json({
      attestations: [{ predicateType: 'https://slsa.dev/provenance/v1' }],
    }),
  ),
  // PyPI — latestVersion + file listing + integrity provenance (404 = none).
  http.get('https://pypi.org/pypi/:name/json', ({ params }) =>
    String(params.name) === 'mycrate-py'
      ? HttpResponse.json({ info: { version: '0.0.1' } })
      : new HttpResponse('{}', { status: 404 }),
  ),
  http.get('https://pypi.org/pypi/:name/:version/json', () =>
    HttpResponse.json({ urls: [{ filename: 'mycrate_py-0.0.1.tar.gz' }] }),
  ),
  http.get('https://pypi.org/integrity/:name/:version/:file/provenance', () =>
    // No trusted-publisher attestation for this package → token.
    new HttpResponse('{"message":"Not Found"}', { status: 404 }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

let repo: string;
const stdoutChunks: string[] = [];

function gitInRepo(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

const FIXTURE_CONFIG = join(
  fileURLToPath(import.meta.url),
  '..',
  'fixtures',
  'status',
  'putitoutthere.toml',
);

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'piot-verify-int-'));
  gitInRepo(['init', '-q', '-b', 'main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Test']);
  gitInRepo(['config', 'commit.gpgsign', 'false']);
  cpSync(FIXTURE_CONFIG, join(repo, 'putitoutthere.toml'));
  gitInRepo(['add', '-A']);
  gitInRepo(['commit', '-q', '-m', 'config']);

  stdoutChunks.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  rmSync(repo, { recursive: true, force: true });
});

interface VerifyRow {
  package: string;
  kind: string;
  version: string | null;
  posture: string;
}

describe('piot verify: publish/trust posture (#414)', () => {
  it('classifies oidc (trusted publisher / provenance) vs token per registry', async () => {
    const code = await run(['node', 'piot', 'verify', '--json', '--cwd', repo]);
    const rows = JSON.parse(stdoutChunks.join('') || '[]') as VerifyRow[];
    const byPkg = Object.fromEntries(rows.map((r) => [r.package, r]));

    // crates.io trustpub_data present → OIDC.
    expect(byPkg['mycrate-rust']).toMatchObject({ version: '0.0.1', posture: 'oidc' });
    // npm provenance attestation present → OIDC.
    expect(byPkg['mycrate-npm']).toMatchObject({ version: '0.0.1', posture: 'oidc' });
    // PyPI has no trusted-publisher attestation → token-dependent.
    expect(byPkg['mycrate-py']).toMatchObject({ version: '0.0.1', posture: 'token' });
    expect(code).toBe(0);
  });
});

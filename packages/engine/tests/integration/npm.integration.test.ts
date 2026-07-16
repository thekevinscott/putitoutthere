/**
 * npm integration test. Runs the npm handler's isPublished + publish
 * against a simulated registry implemented by mocking the process seam
 * (`execCapture`).
 *
 * The npm handler shells out to the `npm` CLI (instead of hitting
 * REST endpoints directly), so msw can't intercept. A verdaccio
 * in-process process would be the purist form of this test, but the
 * seam mock covers the same handler contract at a tenth of the startup
 * cost.
 *
 * Issue #27. Plan: §23.3.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { npm } from '../../src/handlers/npm.js';
import { execCapture } from '../../src/utils/exec-capture.js';
import { ExecError } from '../../src/utils/exec-error.js';
import type { Ctx } from '../../src/types.js';

vi.mock('../../src/utils/exec-capture.js', async (orig) => {
  const actual = await orig<typeof import('../../src/utils/exec-capture.js')>();
  return { ...actual, execCapture: vi.fn(actual.execCapture) };
});

const execMock = vi.mocked(execCapture);

interface FakeRegistry {
  published: Set<string>;
  publishedPayloads: Array<{ name: string; version: string; flags: string[] }>;
}

function fakeRegistry(): FakeRegistry {
  return { published: new Set(), publishedPayloads: [] };
}

function wireRegistry(reg: FakeRegistry, dir: string): void {
  execMock.mockImplementation((_cmd, args) => {
    const a = args as string[];
    if (a[0] === 'view') {
      const [name, version] = String(a[1]).split('@');
      if (reg.published.has(`${name!}@${version!}`)) {
        return Promise.resolve({ stdout: `${version!}\n`, stderr: '' });
      }
      return Promise.reject(new ExecError('E404', '', '404 not found', 1));
    }
    if (a[0] === 'publish') {
      const pkgJson = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { name: string; version: string };
      reg.published.add(`${pkgJson.name}@${pkgJson.version}`);
      reg.publishedPayloads.push({
        name: pkgJson.name,
        version: pkgJson.version,
        flags: a.filter((s) => s.startsWith('--')),
      });
      return Promise.resolve({ stdout: '', stderr: '' });
    }
    /* v8 ignore next -- only view + publish are called */
    return Promise.reject(new Error(`unexpected npm subcommand: ${a[0]}`));
  });
}

let dir: string;

beforeEach(() => {
  execMock.mockReset();
  dir = mkdtempSync(join(tmpdir(), 'npm-int-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'demo-pkg',
      version: '0.1.0',
      repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
    }),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const pkg = {
  name: 'demo-pkg',
  kind: 'npm' as const,
  path: '',
  paths: ['**'],
  depends_on: [],
  first_version: '0.1.0',
};

function ctx(): Ctx {
  return {
    cwd: dir,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    env: { NODE_AUTH_TOKEN: 'tok' },
    artifacts: { get: () => '', has: () => false },
  };
}

describe('npm handler (integration with fake registry)', () => {
  it('isPublished → publish → isPublished round-trip', async () => {
    const reg = fakeRegistry();
    wireRegistry(reg, dir);
    const p = { ...pkg, path: dir };

    expect(await npm.isPublished(p, '0.1.0', ctx())).toBe(false);
    const result = await npm.publish(p, '0.1.0', ctx());
    expect(result.status).toBe('published');
    expect(reg.publishedPayloads).toHaveLength(1);
    expect(reg.publishedPayloads[0]!.name).toBe('demo-pkg');
    expect(await npm.isPublished(p, '0.1.0', ctx())).toBe(true);
  });

  it('second publish of the same version short-circuits to already-published', async () => {
    const reg = fakeRegistry();
    reg.published.add('demo-pkg@0.1.0');
    wireRegistry(reg, dir);

    const result = await npm.publish({ ...pkg, path: dir }, '0.1.0', ctx());
    expect(result.status).toBe('already-published');
    // Only the isPublished view call; no publish attempted.
    expect(reg.publishedPayloads).toHaveLength(0);
  });
});

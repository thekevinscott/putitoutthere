/**
 * npm integration test. Runs the npm handler's isPublished + publish
 * against a simulated registry implemented by mocking the Node built-in
 * `execFile` underneath the real process seam (`execCapture`).
 *
 * The npm handler shells out to the `npm` CLI (instead of hitting
 * REST endpoints directly), so msw can't intercept. A verdaccio
 * in-process process would be the purist form of this test, but the
 * seam mock covers the same handler contract at a tenth of the startup
 * cost.
 *
 * Issue #27. Plan: §23.3.
 */

import { EventEmitter } from 'node:events';
import type * as ChildProcess from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { npm } from '../../src/handlers/npm.js';
import type { Ctx } from '../../src/types.js';

// Integration tests run the first-party exec seam for real and mock only the
// Node built-in underneath it — `execFile` (what `execCapture` uses). Mocking
// the seam module itself would trip the testing-conventions
// `no-first-party-mock` gate.
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof ChildProcess>();
  return { ...actual, execFile: vi.fn() };
});

const execMock = vi.mocked(execFile);

/** A minimal execFile-child stand-in that emits `close` with `code`. */
function fakeChild(code: number): ChildProcess.ChildProcess {
  const child = new EventEmitter() as ChildProcess.ChildProcess;
  queueMicrotask(() => child.emit('close', code));
  return child;
}

interface FakeRegistry {
  published: Set<string>;
  publishedPayloads: Array<{ name: string; version: string; flags: string[] }>;
}

function fakeRegistry(): FakeRegistry {
  return { published: new Set(), publishedPayloads: [] };
}

function wireRegistry(reg: FakeRegistry, dir: string): void {
  execMock.mockImplementation(((_cmd: string, args: readonly string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const a = [...(args ?? [])] as string[];
    if (a[0] === 'view') {
      const [name, version] = String(a[1]).split('@');
      if (reg.published.has(`${name!}@${version!}`)) {
        cb(null, `${version!}\n`, '');
        return fakeChild(0);
      }
      cb(Object.assign(new Error('E404'), { code: 1 }), '', '404 not found');
      return fakeChild(1);
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
      cb(null, '', '');
      return fakeChild(0);
    }
    /* v8 ignore next -- only view + publish are called */
    cb(Object.assign(new Error(`unexpected npm subcommand: ${a[0]}`), { code: 1 }), '', '');
    return fakeChild(1);
  }) as unknown as typeof execFile);
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

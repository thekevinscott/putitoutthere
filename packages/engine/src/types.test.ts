import { describe, expect, it, vi } from 'vitest';
import { attachHandlerMeta } from './attach-handler-meta.js';
import { normalizeTarget } from './normalize-target.js';
import { readHandlerMeta } from './read-handler-meta.js';
import * as types from './types.js';
import {
  AuthError,
  TransientError,
  type Ctx,
  type PlatformPublishSummary,
  type PublishResult,
} from './types.js';

vi.mock('./attach-handler-meta.js');
vi.mock('./normalize-target.js');
vi.mock('./read-handler-meta.js');

describe('re-exports', () => {
  it('keeps the moved helpers importable from types.js', () => {
    expect(types.attachHandlerMeta).toBe(attachHandlerMeta);
    expect(types.normalizeTarget).toBe(normalizeTarget);
    expect(types.readHandlerMeta).toBe(readHandlerMeta);
  });
});

describe('error classes', () => {
  it('AuthError exposes its name and message', () => {
    const e = new AuthError('bad token');
    expect(e.name).toBe('AuthError');
    expect(e.message).toBe('bad token');
    expect(e instanceof Error).toBe(true);
  });

  it('TransientError exposes its name and message', () => {
    const e = new TransientError('registry 502');
    expect(e.name).toBe('TransientError');
    expect(e.message).toBe('registry 502');
    expect(e instanceof Error).toBe(true);
  });
});

describe('PublishResult.status (#623)', () => {
  it('admits `delegated`, distinct from `published`', () => {
    // A handler that uploaded nothing must be able to say so: `publish()`
    // cuts the git tag on `published` and deliberately does not on
    // `delegated`, which is what keeps a tag off the remote for a PyPI
    // version the caller-side job has not uploaded yet. The assignment
    // below is the compile-time half — `tsc` rejects it if the union ever
    // loses the member — and the literal is what the branch keys on.
    const delegated: PublishResult = {
      status: 'delegated',
      url: 'https://pypi.org/project/demo/1.0.0/',
    };
    const published: PublishResult = { status: 'published' };

    expect(delegated.status).toBe('delegated');
    expect(delegated.status).not.toBe(published.status);
  });
});

describe('PublishResult platform summary (#625)', () => {
  it('is satisfiable without mentioning a platform family at all', () => {
    // The load-bearing property of the #625 design: `platforms` is
    // OPTIONAL. Every crates / pypi / vanilla-npm publish returns a result
    // with no platform family, and if the field ever became required the
    // natural way to satisfy it would be an empty
    // `{published: [], skipped: []}` — which reads as a family that shipped
    // nothing, the exact misreport #625 removed. This assignment is the
    // guard: it stops compiling under `tsc --noEmit` the moment `platforms`
    // stops being optional. The runtime half pins the consequence that
    // matters — the key is absent from the JSON report, not present as
    // `null`/`undefined`.
    const noFamily: PublishResult = { status: 'published', url: 'https://npm/x' };

    expect(Object.hasOwn(noFamily, 'platforms')).toBe(false);
    expect(JSON.parse(JSON.stringify(noFamily))).toEqual({
      status: 'published',
      url: 'https://npm/x',
    });
  });

  it('carries both lists into the JSON report when a family shipped', () => {
    // `published` and `skipped` are both reported, and both survive the
    // `JSON.stringify` the CLI runs — an empty `skipped` must serialize as
    // `[]` rather than vanishing, since "nothing was skipped" and "we did
    // not look" are different answers to the operator's question.
    const summary: PlatformPublishSummary = {
      published: ['demo-x86_64-unknown-linux-gnu'],
      skipped: [],
    };
    const shipped: PublishResult = { status: 'published', platforms: summary };

    expect(JSON.parse(JSON.stringify(shipped))).toEqual({
      status: 'published',
      platforms: { published: ['demo-x86_64-unknown-linux-gnu'], skipped: [] },
    });
  });
});

describe('Ctx.managedManifestPaths (#639)', () => {
  /** A Ctx with only the fields every flow must supply. */
  const base = (): Ctx => ({
    cwd: '/repo',
    log: { debug() {}, info() {}, warn() {}, error() {} },
    env: {},
    artifacts: { get: (n) => n, has: () => true },
  });

  it('is optional, so local and doctor flows can omit it', () => {
    // The crates dirty-tree guard falls back to allowing only the package's
    // own manifest when it is absent; making it required would force every
    // caller that never publishes to invent a value.
    const ctx = base();
    expect(ctx.managedManifestPaths).toBeUndefined();
  });

  it('carries the manifests a writeVersion wrote, in order', () => {
    // `publish` fills this from `writeVersion`'s return value. For a crate
    // that inherits its version that includes the workspace root — a file
    // outside the package directory, which is exactly why the guard needs
    // to be told about it.
    const ctx: Ctx = {
      ...base(),
      managedManifestPaths: ['/repo/Cargo.toml', '/repo/packages/rust/Cargo.toml'],
    };
    expect(ctx.managedManifestPaths).toEqual([
      '/repo/Cargo.toml',
      '/repo/packages/rust/Cargo.toml',
    ]);
  });
});

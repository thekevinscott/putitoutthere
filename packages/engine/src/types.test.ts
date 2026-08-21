import { describe, expect, it } from 'vitest';
import {
  AuthError,
  TransientError,
  attachHandlerMeta,
  normalizeTarget,
  readHandlerMeta,
  type Ctx,
  type PlatformPublishSummary,
  type PublishResult,
} from './types.js';

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

describe('handler-error meta (Phase 2 / Idea 9)', () => {
  it('attaches and reads back tool-version metadata', () => {
    const err = new Error('twine upload failed');
    attachHandlerMeta(err, {
      toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
    });
    expect(readHandlerMeta(err)).toEqual({
      toolVersions: { twine: 'twine 5.1.0', python: 'Python 3.12.6' },
    });
  });

  it('returns undefined for an Error without attached meta', () => {
    expect(readHandlerMeta(new Error('plain'))).toBeUndefined();
  });

  it('returns undefined for non-Error values', () => {
    expect(readHandlerMeta('a string')).toBeUndefined();
    expect(readHandlerMeta(undefined)).toBeUndefined();
    expect(readHandlerMeta(null)).toBeUndefined();
  });

  it('attachHandlerMeta returns the same Error so callers can throw inline', () => {
    const err = new Error('x');
    const same = attachHandlerMeta(err, { toolVersions: { tool: '1.0.0' } });
    expect(same).toBe(err);
  });
});

describe('normalizeTarget (#159)', () => {
  it('normalizes a bare-string target to the triple-only object form', () => {
    expect(normalizeTarget('x86_64-unknown-linux-gnu')).toEqual({
      triple: 'x86_64-unknown-linux-gnu',
    });
  });

  it('preserves triple + runner when both are present', () => {
    expect(
      normalizeTarget({ triple: 'aarch64-unknown-linux-gnu', runner: 'ubuntu-24.04-arm' }),
    ).toEqual({
      triple: 'aarch64-unknown-linux-gnu',
      runner: 'ubuntu-24.04-arm',
    });
  });

  it('omits runner when absent on the object form', () => {
    const n = normalizeTarget({ triple: 'x86_64-pc-windows-msvc' });
    expect(n.triple).toBe('x86_64-pc-windows-msvc');
    expect('runner' in n).toBe(false);
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

/**
 * `polyglot-everything` structurally exercises the shape it claims —
 * integration.
 *
 * Issue #641. The in-process twin of
 * `tests/e2e/polyglot-fixture-shape.e2e.test.ts`: same fixture, same
 * scenario, two fidelities. The e2e shells out to the real CLI and lets real
 * cargo read the result; this one drives `writeVersionForBuild` directly and
 * parses the manifests, so the contract has a deterministic gate that needs
 * neither a built `dist/` nor a cargo toolchain.
 *
 * The fixture is positioned — by its own comment, and by
 * `notes/design-commitments.md`'s v0 success criterion — as the canary for
 * exactly one bug class: an artifact that embeds a sibling crate by path
 * shipping that sibling's stale `CARGO_PKG_VERSION`. That bug shipped twice
 * (#374, then #621). The fixture lacked every structural precondition for
 * catching it: no cargo workspace, no path-dependency from the pyo3
 * extension module to the core, and a `main.rs` printing a literal string
 * rather than a version.
 *
 * This is not a consumer-visible bug — nothing shipped wrong because of it.
 * It is the safety net for that failure mode having no net in it.
 */

import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeVersionForBuild } from '../../src/write-version.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures');

const FIXTURE = 'polyglot-everything';
const CORE_CRATE = 'piot-fixture-zzz-poly-rust';
const RELEASE = '0.4.2';
const BASE = '0.1.0';

interface CargoManifest {
  package?: { version?: unknown };
  workspace?: { members?: unknown };
  dependencies?: Record<string, unknown>;
}

let repo: string;

function prepareFixture(): void {
  repo = mkdtempSync(join(tmpdir(), `piot-${FIXTURE}-shape-int-`));
  cpSync(join(FIXTURES_DIR, FIXTURE), repo, { recursive: true });
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {walk(p);}
        continue;
      }
      const body = readFileSync(p, 'utf8');
      if (body.includes('__VERSION__')) {
        writeFileSync(p, body.replaceAll('__VERSION__', BASE), 'utf8');
      }
    }
  };
  walk(repo);
}

function manifest(rel: string): CargoManifest {
  return parseToml(readFileSync(join(repo, rel), 'utf8')) as CargoManifest;
}

/** The `version` requirement the extension module declares on the core. */
function coreRequirement(): string | undefined {
  const dep = manifest('packages/python/Cargo.toml').dependencies?.[CORE_CRATE];
  if (dep === undefined || dep === null) {return undefined;}
  if (typeof dep === 'string') {return dep;}
  const version = (dep as { version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
}

beforeEach(prepareFixture);

afterEach(() => {
  if (repo) {rmSync(repo, { recursive: true, force: true });}
});

describe('polyglot-everything mirrors the shape it claims (#641)', () => {
  it('declares a cargo workspace covering the core and the extension module', () => {
    // Without a workspace root the two crates are not one build unit, and
    // the `version.workspace = true` inheritance path (#428) has nothing to
    // inherit from.
    const members = manifest('Cargo.toml').workspace?.members;
    expect(Array.isArray(members)).toBe(true);
    expect((members as string[]).join(' ')).toContain('packages/rust');
    expect((members as string[]).join(' ')).toContain('packages/python');
  });

  it('has the extension module path-dep the core crate with a version requirement', () => {
    // Mandatory for any crate that also publishes to crates.io, and the
    // half of #621 that turns a stale bump into a hard resolution failure.
    const dep = manifest('packages/python/Cargo.toml').dependencies?.[CORE_CRATE] as
      | { path?: unknown }
      | undefined;
    expect(dep).toBeDefined();
    expect(dep?.path).toBe('../rust');
    expect(coreRequirement()).toBe(BASE);
  });

  it('carries the release version into the embedded core crate', async () => {
    // The #374 / #621 bug stated as a test: the wheel embeds the core, the
    // core owns the version-bearing symbol, nothing bumped it.
    await writeVersionForBuild(join(repo, 'packages/python'), RELEASE);
    expect(manifest('packages/rust/Cargo.toml').package?.version).toBe(RELEASE);
  });

  it('moves the requirement pointing at the core along with it', async () => {
    await writeVersionForBuild(join(repo, 'packages/python'), RELEASE);
    expect(coreRequirement()).toBe(RELEASE);
  });

  it('exposes the core crate version through a real symbol', () => {
    // A `main.rs` printing a literal is why no test could assert on what
    // the artifact reports — there was no value that could ever be wrong.
    expect(readFileSync(join(repo, 'packages/rust/src/main.rs'), 'utf8')).toContain(
      'CARGO_PKG_VERSION',
    );
  });
});

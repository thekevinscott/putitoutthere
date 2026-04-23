/**
 * Config loader tests. TDD-style: these specify the contract before
 * the implementation lands.
 *
 * Issue #5. Plan: plan.md §6.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parseConfig } from './config.js';

const MINIMAL = `
[putitoutthere]
version = 1

[[package]]
name  = "app"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
`;

describe('parseConfig: happy paths', () => {
  it('parses a minimal valid config', () => {
    const cfg = parseConfig(MINIMAL);
    expect(cfg.putitoutthere.version).toBe(1);
    expect(cfg.packages).toHaveLength(1);
    const pkg = cfg.packages[0]!;
    expect(pkg.name).toBe('app');
    expect(pkg.kind).toBe('crates');
  });

  it('applies default depends_on = []', () => {
    const cfg = parseConfig(MINIMAL);
    expect(cfg.packages[0]!.depends_on).toEqual([]);
  });

  it('applies default first_version = "0.1.0"', () => {
    const cfg = parseConfig(MINIMAL);
    expect(cfg.packages[0]!.first_version).toBe('0.1.0');
  });

  it('applies default pypi build = "setuptools" when omitted (#129)', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "py"
kind  = "pypi"
path  = "packages/py"
paths = ["packages/py/**"]
`);
    const pkg = cfg.packages[0]! as { kind: string; build?: string };
    expect(pkg.kind).toBe('pypi');
    expect(pkg.build).toBe('setuptools');
  });

  it('accepts optional top-level fields', () => {
    const cfg = parseConfig(`
[putitoutthere]
version     = 1
cadence     = "scheduled"
agents_path = "custom/AGENTS.md"

[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
`);
    expect(cfg.putitoutthere.cadence).toBe('scheduled');
    expect(cfg.putitoutthere.agents_path).toBe('custom/AGENTS.md');
  });

  it('parses all three kinds in one config', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1

[[package]]
name  = "a-rust"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]

[[package]]
name    = "a-python"
kind    = "pypi"
path    = "packages/python"
paths   = ["packages/python/**"]
build   = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[[package]]
name  = "a-js"
kind  = "npm"
path  = "packages/ts"
paths = ["packages/ts/**"]
`);
    expect(cfg.packages).toHaveLength(3);
    expect(cfg.packages.map((p) => p.kind)).toEqual(['crates', 'pypi', 'npm']);
  });
});

describe('parseConfig: required fields', () => {
  it('rejects missing putitoutthere.version', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
`),
    ).toThrow(/version/);
  });

  it('rejects missing package.name', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
kind  = "crates"
path  = "."
paths = ["**"]
`),
    ).toThrow(/name/);
  });

  it('rejects missing package.paths', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name = "x"
kind = "crates"
path = "."
`),
    ).toThrow(/paths/);
  });

  it('rejects empty package.paths', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = []
`),
    ).toThrow();
  });

  it('rejects zero packages', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
`),
    ).toThrow();
  });
});

describe('parseConfig: unknown fields', () => {
  it('rejects unknown top-level keys', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
unexpected = "oops"

[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
`),
    ).toThrow(/unexpected|unknown|unrecognized/i);
  });

  it('rejects unknown package-base fields', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name   = "x"
kind   = "crates"
path   = "."
paths  = ["**"]
ignored_field = 42
`),
    ).toThrow(/ignored_field|unknown|unrecognized/i);
  });

  it('rejects pypi-specific field on crates package', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
build = "maturin"
`),
    ).toThrow(/build|unknown|unrecognized/i);
  });
});

describe('parseConfig: kind validation', () => {
  it('rejects unknown kind', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "x"
kind  = "rubygems"
path  = "."
paths = ["**"]
`),
    ).toThrow();
  });
});

describe('parseConfig: targets cross-validation (plan §12.2)', () => {
  it('accepts targets on maturin pypi', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
paths   = ["**"]
build   = "maturin"
targets = ["x86_64-unknown-linux-gnu"]
`);
    expect(cfg.packages[0]!.kind).toBe('pypi');
  });

  it('rejects targets on pypi without maturin', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
paths   = ["**"]
build   = "setuptools"
targets = ["x86_64-unknown-linux-gnu"]
`),
    ).toThrow(/target/i);
  });

  it('rejects targets on pypi with no build field', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
paths   = ["**"]
targets = ["x86_64-unknown-linux-gnu"]
`),
    ).toThrow(/target/i);
  });

  it('accepts targets on napi npm', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
paths   = ["**"]
build   = "napi"
targets = ["x86_64-unknown-linux-gnu"]
`);
    expect(cfg.packages[0]!.kind).toBe('npm');
  });

  it('accepts targets on bundled-cli npm', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
paths   = ["**"]
build   = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]
`);
    expect(cfg.packages[0]!.kind).toBe('npm');
  });

  it('rejects targets on vanilla npm', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
paths   = ["**"]
targets = ["x86_64-unknown-linux-gnu"]
`),
    ).toThrow(/target/i);
  });

  it('rejects targets on crates', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "crates"
path    = "."
paths   = ["**"]
targets = ["x86_64-unknown-linux-gnu"]
`),
    ).toThrow(/target|unknown|unrecognized/i);
  });
});

describe('parseConfig: uniqueness', () => {
  it('rejects duplicate package names', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "dup"
kind  = "crates"
path  = "a"
paths = ["**"]
[[package]]
name  = "dup"
kind  = "npm"
path  = "b"
paths = ["**"]
`),
    ).toThrow(/duplicate|dup/i);
  });
});

describe('parseConfig: version literal', () => {
  it('rejects version != 1', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 2
[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
`),
    ).toThrow(/version/i);
  });
});

describe('parseConfig: cadence', () => {
  it('accepts "immediate"', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
cadence = "immediate"
[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
`);
    expect(cfg.putitoutthere.cadence).toBe('immediate');
  });

  it('rejects unknown cadence', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
cadence = "hourly"
[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
`),
    ).toThrow(/cadence/i);
  });
});

describe('parseConfig: handler-specific fields (§6.4)', () => {
  it('accepts crates fields: crate, features', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name     = "x"
kind     = "crates"
path     = "."
paths    = ["**"]
crate    = "actual-name"
features = ["a", "b"]
`);
    const pkg = cfg.packages[0]!;
    expect(pkg.kind).toBe('crates');
    // Handler-specific fields are preserved for the handler to consume.
    expect((pkg as { crate?: string }).crate).toBe('actual-name');
  });

  it('rejects `target` on crates packages (#127)', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name   = "x"
kind   = "crates"
path   = "."
paths  = ["**"]
target = ["x86_64-unknown-linux-gnu"]
`),
    ).toThrow(/target/i);
  });

  it('accepts pypi fields: pypi, build, wheels_artifact', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name            = "x"
kind            = "pypi"
path            = "."
paths           = ["**"]
pypi            = "the-name"
build           = "maturin"
wheels_artifact = "custom-wheels"
targets         = ["x86_64-unknown-linux-gnu"]
`);
    const pkg = cfg.packages[0]! as {
      pypi?: string;
      build?: string;
      wheels_artifact?: string;
    };
    expect(pkg.pypi).toBe('the-name');
    expect(pkg.build).toBe('maturin');
    expect(pkg.wheels_artifact).toBe('custom-wheels');
  });

  it('accepts npm fields: npm, access, tag', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name   = "x"
kind   = "npm"
path   = "."
paths  = ["**"]
npm    = "the-name"
access = "public"
tag    = "next"
`);
    const pkg = cfg.packages[0]! as { npm?: string; access?: string; tag?: string };
    expect(pkg.npm).toBe('the-name');
    expect(pkg.access).toBe('public');
    expect(pkg.tag).toBe('next');
  });

  it('rejects invalid npm access value', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name   = "x"
kind   = "npm"
path   = "."
paths  = ["**"]
access = "maybe"
`),
    ).toThrow();
  });

  it('rejects invalid pypi build value', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "x"
kind  = "pypi"
path  = "."
paths = ["**"]
build = "poetry"
`),
    ).toThrow();
  });
});

describe('parseConfig: smoke + depends_on', () => {
  it('accepts depends_on and preserves order', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "crates"
path  = "a"
paths = ["a/**"]
[[package]]
name       = "b"
kind       = "pypi"
path       = "b"
paths      = ["b/**"]
depends_on = ["a"]
`);
    expect(cfg.packages[1]!.depends_on).toEqual(['a']);
  });

  it('accepts smoke command', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "x"
kind  = "crates"
path  = "."
paths = ["**"]
smoke = "./smoke-test.sh"
`);
    expect(cfg.packages[0]!.smoke).toBe('./smoke-test.sh');
  });
});

describe('parseConfig: TOML errors', () => {
  it('surfaces a clear error for malformed TOML', () => {
    expect(() => parseConfig('not = valid = toml')).toThrow();
  });

  it('preserves the underlying parse error as `cause`', () => {
    // @eslint/js 10 enabled `preserve-caught-error` by default; this
    // test pins the cause-chain contract so a future refactor doesn't
    // accidentally drop the inner error.
    try {
      parseConfig('not = valid = toml');
      throw new Error('expected parseConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeInstanceOf(Error);
    }
  });
});

describe('loadConfig: filesystem', () => {
  it('reads a valid config from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'putitoutthere-cfg-'));
    try {
      const path = join(dir, 'putitoutthere.toml');
      writeFileSync(path, MINIMAL, 'utf8');
      const cfg = loadConfig(path);
      expect(cfg.packages[0]!.name).toBe('app');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the file does not exist', () => {
    const path = join(tmpdir(), 'putitoutthere-does-not-exist-xxxxxx.toml');
    expect(() => loadConfig(path)).toThrow(/cannot read/);
  });
});

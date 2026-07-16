/**
 * Config loader tests. TDD-style: these specify the contract before
 * the implementation lands.
 *
 * Issue #5. Plan: plan.md §6.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  detectCommonMistakes,
  formatZodError,
  loadConfig,
  parseConfig,
  sanitizeArtifactName,
} from './config.js';

// `loadConfig`'s only collaborator is `node:fs`; mock it so the loader/parser
// is isolated from disk. The real read is covered at the integration + e2e
// tiers.
vi.mock('node:fs');

const readFileSyncMock = vi.mocked(readFileSync);

const MINIMAL = `
[putitoutthere]
version = 1

[[package]]
name  = "app"
kind  = "crates"
path  = "packages/rust"
globs = ["packages/rust/**"]
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

  it('applies default tag_format = "{name}-v{version}"', () => {
    const cfg = parseConfig(MINIMAL);
    expect(cfg.packages[0]!.tag_format).toBe('{name}-v{version}');
  });

  it('accepts a custom tag_format like "v{version}"', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name       = "app"
kind       = "crates"
path       = "."
globs      = ["**"]
tag_format = "v{version}"
`);
    expect(cfg.packages[0]!.tag_format).toBe('v{version}');
  });

  it('rejects a tag_format missing {version}', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name       = "app"
kind       = "crates"
path       = "."
globs      = ["**"]
tag_format = "{name}-v"
`),
    ).toThrow(/tag_format must contain \{version\}/);
  });

  it('rejects a tag_format with an unknown placeholder', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name       = "app"
kind       = "crates"
path       = "."
globs      = ["**"]
tag_format = "{name}-{bogus}-v{version}"
`),
    ).toThrow(/unknown placeholder/);
  });

  it('applies default pypi build = "setuptools" when omitted (#129)', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "py"
kind  = "pypi"
path  = "packages/py"
globs = ["packages/py/**"]
`);
    const pkg = cfg.packages[0]! as { kind: string; build?: string };
    expect(pkg.kind).toBe('pypi');
    expect(pkg.build).toBe('setuptools');
  });

  it('parses all three kinds in one config', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1

[[package]]
name  = "a-rust"
kind  = "crates"
path  = "packages/rust"
globs = ["packages/rust/**"]

[[package]]
name    = "a-python"
kind    = "pypi"
path    = "packages/python"
globs   = ["packages/python/**"]
build   = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[[package]]
name  = "a-js"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
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
globs = ["**"]
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
globs = ["**"]
`),
    ).toThrow(/name/);
  });

  it('rejects missing package.globs', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name = "x"
kind = "crates"
path = "."
`),
    ).toThrow(/globs/);
  });

  it('rejects empty package.globs', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "x"
kind  = "crates"
path  = "."
globs = []
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
globs = ["**"]
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
globs  = ["**"]
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
globs = ["**"]
build = "maturin"
`),
    ).toThrow(/build|unknown|unrecognized/i);
  });
});

describe('parseConfig: friendly hints for common mistakes', () => {
  // The integration failure that motivates these hints (#integration-2026-05):
  // a consumer wrote `version = 1` at the file root, used `[[packages]]`
  // (plural), `registry =` instead of `kind =`, and `files =` instead of
  // `globs =`. The raw zod errors ("Invalid input: expected object, received
  // undefined; ...; Unrecognized keys: \"version\", \"packages\"") were too
  // opaque to recover from without reading the schema source. Each hint here
  // names the mistake and the fix in one breath.

  it('hints when [putitoutthere] table is missing entirely', () => {
    // No `[putitoutthere]` table, just a raw `version = 1` at the file root
    // alongside `[[packages]]` (plural). Reproduction of the exact integration
    // failure from #integration-2026-05.
    expect(() =>
      parseConfig(`
version = 1

[[packages]]
name = "x"
kind = "crates"
path = "."
globs = ["**"]
`),
    ).toThrow(/missing \[putitoutthere\] table/i);
  });

  it('hints "did you mean [[package]]?" when [[packages]] is used', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1

[[packages]]
name = "x"
kind = "crates"
path = "."
globs = ["**"]
`),
    ).toThrow(/\[\[packages\]\].+\[\[package\]\]/);
  });

  it('hints "did you mean kind?" when registry= is used', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1

[[package]]
name     = "x"
registry = "crates"
path     = "."
globs    = ["**"]
`),
    ).toThrow(/registry.+kind/i);
  });

  it('hints "did you mean globs?" when files= is used', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1

[[package]]
name  = "x"
kind  = "crates"
path  = "."
files = ["**"]
`),
    ).toThrow(/files.+globs/i);
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
globs = ["**"]
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
globs   = ["**"]
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
globs   = ["**"]
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
globs   = ["**"]
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
globs   = ["**"]
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
globs   = ["**"]
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
globs   = ["**"]
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
globs   = ["**"]
targets = ["x86_64-unknown-linux-gnu"]
`),
    ).toThrow(/target|unknown|unrecognized/i);
  });
});

describe('parseConfig: per-target runner override (#159)', () => {
  it('accepts object-form targets with runner on maturin pypi', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
globs   = ["**"]
build   = "maturin"
targets = [
  "x86_64-unknown-linux-gnu",
  { triple = "aarch64-unknown-linux-gnu", runner = "ubuntu-24.04-arm" },
]
`);
    const pkg = cfg.packages[0]!;
    expect(pkg.kind).toBe('pypi');
    // Roundtrip: bare string stays a string; object retains both fields.
    const targets = (pkg as { targets?: unknown[] }).targets!;
    expect(targets[0]).toBe('x86_64-unknown-linux-gnu');
    expect(targets[1]).toEqual({
      triple: 'aarch64-unknown-linux-gnu',
      runner: 'ubuntu-24.04-arm',
    });
  });

  it('accepts object-form targets with runner on napi npm', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = "napi"
targets = [
  { triple = "aarch64-apple-darwin", runner = "macos-14" },
]
`);
    const targets = (cfg.packages[0] as { targets?: unknown[] }).targets!;
    expect(targets[0]).toEqual({ triple: 'aarch64-apple-darwin', runner: 'macos-14' });
  });

  it('accepts object-form targets without a runner (triple-only)', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
globs   = ["**"]
build   = "maturin"
targets = [{ triple = "x86_64-unknown-linux-gnu" }]
`);
    const targets = (cfg.packages[0] as { targets?: unknown[] }).targets!;
    expect(targets[0]).toEqual({ triple: 'x86_64-unknown-linux-gnu' });
  });

  it('rejects unknown keys inside the object form (typo guard)', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
globs   = ["**"]
build   = "maturin"
targets = [{ triple = "x86_64-unknown-linux-gnu", runs_on = "ubuntu-latest" }]
`),
    ).toThrow(/invalid|unrecognized|unknown|runs_on/i);
  });

  it('rejects object form missing triple', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
globs   = ["**"]
build   = "maturin"
targets = [{ runner = "ubuntu-24.04-arm" }]
`),
    ).toThrow();
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
globs = ["**"]
[[package]]
name  = "dup"
kind  = "npm"
path  = "b"
globs = ["**"]
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
globs = ["**"]
`),
    ).toThrow(/version/i);
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
globs    = ["**"]
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
globs  = ["**"]
target = ["x86_64-unknown-linux-gnu"]
`),
    ).toThrow(/target/i);
  });

  it('accepts pypi fields: pypi, build', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
globs   = ["**"]
pypi    = "the-name"
build   = "maturin"
targets = ["x86_64-unknown-linux-gnu"]
`);
    const pkg = cfg.packages[0]! as { pypi?: string; build?: string };
    expect(pkg.pypi).toBe('the-name');
    expect(pkg.build).toBe('maturin');
  });

  it('accepts npm fields: npm, access, tag', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name   = "x"
kind   = "npm"
path   = "."
globs  = ["**"]
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
globs  = ["**"]
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
globs = ["**"]
build = "poetry"
`),
    ).toThrow();
  });
});

describe('parseConfig: depends_on', () => {
  it('accepts depends_on and preserves order', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "crates"
path  = "a"
globs = ["a/**"]
[[package]]
name       = "b"
kind       = "pypi"
path       = "b"
globs      = ["b/**"]
depends_on = ["a"]
`);
    expect(cfg.packages[1]!.depends_on).toEqual(['a']);
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
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });

  it('reads a valid config from disk', () => {
    readFileSyncMock.mockReturnValue(MINIMAL);
    const cfg = loadConfig('putitoutthere.toml');
    expect(cfg.packages[0]!.name).toBe('app');
  });

  it('throws a clear error when the file does not exist', () => {
    readFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    });
    expect(() => loadConfig('does-not-exist.toml')).toThrow(/cannot read/);
  });
});

/* --------------------- #217: bundle_cli on pypi --------------------- */

describe('parseConfig: bundle_cli (#217)', () => {
  const WITH_BUNDLE = `
[putitoutthere]
version = 1

[[package]]
name = "my-py"
kind = "pypi"
path = "py/my-py"
globs = ["py/my-py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]

[package.bundle_cli]
bin = "my-cli"
stage_to = "src/my_py/_binary"
crate_path = "crates/my-rust"
`;

  it('accepts a complete [package.bundle_cli] block', () => {
    const cfg = parseConfig(WITH_BUNDLE);
    const pkg = cfg.packages[0] as { bundle_cli?: { bin: string; stage_to: string; crate_path: string; features: string[]; no_default_features: boolean } };
    expect(pkg.bundle_cli).toEqual({
      bin: 'my-cli',
      stage_to: 'src/my_py/_binary',
      crate_path: 'crates/my-rust',
      features: [],
      no_default_features: false,
    });
  });

  it('defaults crate_path to "." when omitted', () => {
    const cfg = parseConfig(
      WITH_BUNDLE.replace('crate_path = "crates/my-rust"\n', ''),
    );
    const pkg = cfg.packages[0] as { bundle_cli?: { crate_path: string } };
    expect(pkg.bundle_cli?.crate_path).toBe('.');
  });

  it('rejects bundle_cli without build = "maturin"', () => {
    const bad = WITH_BUNDLE.replace('build = "maturin"', 'build = "setuptools"');
    expect(() => parseConfig(bad)).toThrow(/bundle_cli is only valid when build = "maturin"/);
  });

  it('rejects bundle_cli without targets', () => {
    const bad = WITH_BUNDLE.replace(
      'targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]\n',
      '',
    );
    expect(() => parseConfig(bad)).toThrow(/bundle_cli requires at least one entry in `targets`/);
  });

  it('rejects missing bin', () => {
    const bad = WITH_BUNDLE.replace('bin = "my-cli"\n', '');
    expect(() => parseConfig(bad)).toThrow();
  });

  it('rejects missing stage_to', () => {
    const bad = WITH_BUNDLE.replace('stage_to = "src/my_py/_binary"\n', '');
    expect(() => parseConfig(bad)).toThrow();
  });

  it('rejects unknown keys inside bundle_cli (typo guard)', () => {
    const bad = WITH_BUNDLE + 'extra = "huh"\n';
    expect(() => parseConfig(bad)).toThrow();
  });

  it('rejects bundle_cli on non-pypi packages', () => {
    const bad = `
[putitoutthere]
version = 1

[[package]]
name = "my-pkg"
kind = "npm"
path = "packages/my-pkg"
globs = ["packages/my-pkg/**"]

[package.bundle_cli]
bin = "my-cli"
stage_to = "bin"
`;
    expect(() => parseConfig(bad)).toThrow();
  });
});

/* --------------------- #300: bundle_cli features --------------------- */

describe('parseConfig: bundle_cli features (#300)', () => {
  const WITH_BUNDLE = `
[putitoutthere]
version = 1

[[package]]
name = "my-py"
kind = "pypi"
path = "py/my-py"
globs = ["py/my-py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
stage_to = "src/my_py/_binary"
crate_path = "crates/my-rust"
`;

  it('accepts features and no_default_features inside bundle_cli', () => {
    const cfg = parseConfig(
      WITH_BUNDLE +
        `features = ["cli"]
no_default_features = true
`,
    );
    const pkg = cfg.packages[0] as {
      bundle_cli?: { features: string[]; no_default_features: boolean };
    };
    expect(pkg.bundle_cli?.features).toEqual(['cli']);
    expect(pkg.bundle_cli?.no_default_features).toBe(true);
  });

  it('defaults features to [] and no_default_features to false', () => {
    const cfg = parseConfig(WITH_BUNDLE);
    const pkg = cfg.packages[0] as {
      bundle_cli?: { features: string[]; no_default_features: boolean };
    };
    expect(pkg.bundle_cli?.features).toEqual([]);
    expect(pkg.bundle_cli?.no_default_features).toBe(false);
  });

  it('rejects empty-string entries in features', () => {
    const bad =
      WITH_BUNDLE +
      `features = ["cli", ""]
`;
    expect(() => parseConfig(bad)).toThrow();
  });

  it('rejects non-string entries in features', () => {
    const bad =
      WITH_BUNDLE +
      `features = ["cli", 1]
`;
    expect(() => parseConfig(bad)).toThrow();
  });
});

/* --------------------- #298: bundle_cli on npm --------------------- */

describe('parseConfig: bundle_cli on npm (#298)', () => {
  const WITH_NPM_BUNDLE = `
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "packages/ts-cli"
globs = ["packages/ts-cli/**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
crate_path = "crates/my-cli"
`;

  it('accepts a complete [package.bundle_cli] block on npm + build = "bundled-cli"', () => {
    const cfg = parseConfig(WITH_NPM_BUNDLE);
    const pkg = cfg.packages[0] as {
      bundle_cli?: {
        bin: string;
        crate_path: string;
        features: string[];
        no_default_features: boolean;
      };
    };
    expect(pkg.bundle_cli).toEqual({
      bin: 'my-cli',
      crate_path: 'crates/my-cli',
      features: [],
      no_default_features: false,
    });
  });

  it('defaults crate_path to "." when omitted', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "."
globs = ["**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
`);
    const pkg = cfg.packages[0] as { bundle_cli?: { crate_path: string } };
    expect(pkg.bundle_cli?.crate_path).toBe('.');
  });

  it('accepts features and no_default_features (mirror of pypi shape)', () => {
    const cfg = parseConfig(
      WITH_NPM_BUNDLE +
        `features = ["cli"]
no_default_features = true
`,
    );
    const pkg = cfg.packages[0] as {
      bundle_cli?: { features: string[]; no_default_features: boolean };
    };
    expect(pkg.bundle_cli?.features).toEqual(['cli']);
    expect(pkg.bundle_cli?.no_default_features).toBe(true);
  });

  it('accepts bundle_cli when build is an array containing a bundled-cli entry', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
build = [
  { mode = "napi",        name = "@my-cli/lib-{triple}" },
  { mode = "bundled-cli", name = "@my-cli/cli-{triple}" },
]
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
`);
    const pkg = cfg.packages[0] as { bundle_cli?: { bin: string } };
    expect(pkg.bundle_cli?.bin).toBe('my-cli');
  });

  it('accepts bundle_cli when build is an array containing a bare bundled-cli string', () => {
    // The build array accepts both bare mode strings (`"bundled-cli"`)
    // and `{ mode, name }` object entries; the refine's
    // `typeof e === 'string'` branch handles the bare-string form.
    // This is the shape polyglot-everything's #dirsql fixture uses.
    const cfg = parseConfig(`
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
build = [
  "bundled-cli",
  { mode = "napi", name = "{name}-napi-{triple}" },
]
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
`);
    const pkg = cfg.packages[0] as { bundle_cli?: { bin: string } };
    expect(pkg.bundle_cli?.bin).toBe('my-cli');
  });

  it('rejects bundle_cli when build is "napi" (no bundled-cli entry)', () => {
    const bad = `
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "."
globs = ["**"]
build = "napi"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
`;
    expect(() => parseConfig(bad)).toThrow(/bundle_cli is only valid when build = "bundled-cli"/);
  });

  it('rejects bundle_cli when build is undefined (vanilla npm)', () => {
    const bad = `
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "."
globs = ["**"]

[package.bundle_cli]
bin = "my-cli"
`;
    expect(() => parseConfig(bad)).toThrow(/bundle_cli is only valid when build = "bundled-cli"/);
  });

  it('rejects bundle_cli when build is an array without a bundled-cli entry', () => {
    const bad = `
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "."
globs = ["**"]
build = [
  { mode = "napi", name = "@my-cli/lib-{triple}" },
]
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = "my-cli"
`;
    expect(() => parseConfig(bad)).toThrow(/bundle_cli is only valid when build = "bundled-cli"/);
  });

  it('rejects bundle_cli without targets', () => {
    const bad = `
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "."
globs = ["**"]
build = "bundled-cli"

[package.bundle_cli]
bin = "my-cli"
`;
    expect(() => parseConfig(bad)).toThrow(/bundle_cli requires at least one entry in `targets`/);
  });

  it('rejects unknown keys inside bundle_cli (typo guard — `stage_to` is pypi-only)', () => {
    const bad =
      WITH_NPM_BUNDLE +
      `stage_to = "bin"
`;
    expect(() => parseConfig(bad)).toThrow();
  });

  it('rejects bundle_cli with empty-string `bin`', () => {
    const bad = `
[putitoutthere]
version = 1

[[package]]
name  = "my-cli"
kind  = "npm"
path  = "."
globs = ["**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu"]

[package.bundle_cli]
bin = ""
`;
    expect(() => parseConfig(bad)).toThrow();
  });
});

// #230: actions/upload-artifact@v4 forbids `/` and several other characters
// in artifact names. The planner encodes `/` to `__` (the only realistically
// usable forbidden char in piot identifiers); the rest are rejected at
// config load. The encoding sequence `__` is reserved in `pkg.name` so the
// round-trip stays unambiguous.
describe('parseConfig: artifact-name-safe `pkg.name` (#230)', () => {
  it('accepts a name with `/` (planner encodes it later)', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "py/cachetta"
kind  = "pypi"
path  = "py/cachetta"
globs = ["py/cachetta/**"]
`);
    expect(cfg.packages[0]!.name).toBe('py/cachetta');
  });

  it('rejects `__` in name (reserved encoding sequence)', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "lib__double"
kind  = "crates"
path  = "."
globs = ["**"]
`),
    ).toThrow(/__/);
  });

  it.each([
    ['backslash', 'lib\\\\name'],
    ['colon', 'lib:name'],
    ['less-than', 'lib<name'],
    ['greater-than', 'lib>name'],
    ['pipe', 'lib|name'],
    ['asterisk', 'lib*name'],
    ['question', 'lib?name'],
    ['quote', 'lib\\"name'],
  ])('rejects %s in name', (_label, badName) => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name  = "${badName}"
kind  = "crates"
path  = "."
globs = ["**"]
`),
    ).toThrow(/upload-artifact|forbidden|registry-safe/);
  });
});

describe('parseConfig: npm build array form (#dirsql)', () => {
  it('accepts a single-mode string (backward compat)', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = "napi"
targets = ["linux-x64-gnu"]
`);
    expect((cfg.packages[0] as { build?: unknown }).build).toBe('napi');
  });

  it('accepts an array of mode strings', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = ["napi"]
targets = ["linux-x64-gnu"]
`);
    expect((cfg.packages[0] as { build?: unknown }).build).toEqual(['napi']);
  });

  it('accepts an array of object entries with `name` templates', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "dirsql"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [
  { mode = "napi",        name = "@dirsql/lib-{triple}" },
  { mode = "bundled-cli", name = "@dirsql/cli-{triple}" },
]
targets = ["linux-x64-gnu"]
`);
    expect((cfg.packages[0] as { build?: unknown }).build).toEqual([
      { mode: 'napi', name: '@dirsql/lib-{triple}' },
      { mode: 'bundled-cli', name: '@dirsql/cli-{triple}' },
    ]);
  });

  it('accepts a mix of bare strings and object entries', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [
  "napi",
  { mode = "bundled-cli", name = "{name}-cli-{triple}" },
]
targets = ["linux-x64-gnu"]
`);
    const build = (cfg.packages[0] as { build?: unknown[] }).build!;
    expect(build).toEqual([
      'napi',
      { mode: 'bundled-cli', name: '{name}-cli-{triple}' },
    ]);
  });

  it('rejects an empty array', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = []
targets = ["linux-x64-gnu"]
`),
    ).toThrow();
  });

  it('rejects duplicate modes', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = ["napi", "napi"]
targets = ["linux-x64-gnu"]
`),
    ).toThrow(/unique modes|napi/);
  });

  it('rejects duplicate modes mixed across string + object entries', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [
  "napi",
  { mode = "napi", name = "{name}-other-{triple}" },
]
targets = ["linux-x64-gnu"]
`),
    ).toThrow(/unique modes|napi/);
  });

  it('rejects a name template missing {triple}', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [{ mode = "napi", name = "@scope/lib-fixed" }]
targets = ["linux-x64-gnu"]
`),
    ).toThrow(/\{triple\}/);
  });

  it('rejects an unknown placeholder in a name template', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [{ mode = "napi", name = "{name}-{version}-{triple}" }]
targets = ["linux-x64-gnu"]
`),
    ).toThrow(/unknown placeholder.*\{version\}/);
  });

  it('rejects an empty name template', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [{ mode = "napi", name = "" }]
targets = ["linux-x64-gnu"]
`),
    ).toThrow(/must not be empty/);
  });

  it('rejects two entries that resolve to colliding names', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [
  { mode = "napi",        name = "{name}-{triple}" },
  { mode = "bundled-cli", name = "{name}-{triple}" },
]
targets = ["linux-x64-gnu"]
`),
    ).toThrow(/distinct.*name templates/);
  });

  it('accepts targets when build is in array form', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "npm"
path    = "."
globs   = ["**"]
build   = [
  { mode = "napi",        name = "@scope/lib-{triple}" },
  { mode = "bundled-cli", name = "@scope/cli-{triple}" },
]
targets = ["linux-x64-gnu", "darwin-arm64"]
`);
    expect((cfg.packages[0] as { targets?: unknown[] }).targets).toEqual([
      'linux-x64-gnu',
      'darwin-arm64',
    ]);
  });
});

describe('sanitizeArtifactName (#230)', () => {
  it('passes through names without `/` unchanged', () => {
    expect(sanitizeArtifactName('lib-rust')).toBe('lib-rust');
    expect(sanitizeArtifactName('lib_python')).toBe('lib_python');
    expect(sanitizeArtifactName('a.b.c')).toBe('a.b.c');
  });

  it('encodes `/` to `__`', () => {
    expect(sanitizeArtifactName('py/cachetta')).toBe('py__cachetta');
  });

  it('encodes every `/` (multi-segment paths)', () => {
    expect(sanitizeArtifactName('lang/py/foo')).toBe('lang__py__foo');
  });
});

describe('parseConfig: python_versions override (#369)', () => {
  it('accepts a python_versions array on a pypi package', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
globs   = ["**"]
build   = "maturin"
targets = ["x86_64-unknown-linux-gnu"]
python_versions = ["3.12", "3.13"]
`);
    const pkg = cfg.packages[0]!;
    expect(pkg.kind).toBe('pypi');
    expect((pkg as Record<string, unknown>)['python_versions']).toEqual(['3.12', '3.13']);
  });

  it('rejects a malformed python_versions entry', () => {
    expect(() =>
      parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
globs   = ["**"]
build   = "hatch"
python_versions = ["3.x"]
`),
    ).toThrow(/python_versions/i);
  });
});

describe('detectCommonMistakes (internal): non-object / non-object-entry guards', () => {
  // `parseConfig` only ever calls this with a parsed-TOML object root, so the
  // non-object early-return and the per-entry non-object skip never fire
  // through the public path. Exercised directly to pin the defensive guards.
  it('returns no hints for a non-object root', () => {
    expect(detectCommonMistakes('not-an-object')).toEqual([]);
    expect(detectCommonMistakes(null)).toEqual([]);
    expect(detectCommonMistakes(['array', 'root'])).toEqual([]);
  });

  it('skips non-object entries in the package array while still hinting on object ones', () => {
    const hints = detectCommonMistakes({
      package: ['a-bare-string', { registry: 'npm', path: '.' }],
    });
    // The string entry is skipped (index 0); the object entry (index 1)
    // still produces the registry→kind hint.
    expect(hints).toEqual([expect.stringMatching(/registry.*kind/)]);
  });
});

describe('formatZodError (internal): root-path label', () => {
  // formatZodError only reads `error.issues[].path` / `.message`, so pass a
  // ZodError-shaped stub rather than importing `zod` — an unmocked collaborator
  // the unit-lint isolation gate forbids in a unit test.
  type ZodErrorLike = Parameters<typeof formatZodError>[0];
  const zodErrorLike = (
    issues: { path: (string | number)[]; message: string }[],
  ): ZodErrorLike => ({ issues }) as unknown as ZodErrorLike;

  it('labels an empty issue path as <root>', () => {
    const err = zodErrorLike([{ path: [], message: 'whole-document problem' }]);
    expect(formatZodError(err)).toBe('<root>: whole-document problem');
  });

  it('joins a non-empty issue path with dots', () => {
    const err = zodErrorLike([{ path: ['package', 0, 'name'], message: 'bad field' }]);
    expect(formatZodError(err)).toBe('package.0.name: bad field');
  });
});

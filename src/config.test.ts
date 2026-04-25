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
import { loadConfig, parseConfig, sanitizeArtifactName } from './config.js';

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
paths      = ["**"]
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
paths      = ["**"]
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
paths      = ["**"]
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

describe('parseConfig: per-target runner override (#159)', () => {
  it('accepts object-form targets with runner on maturin pypi', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1
[[package]]
name    = "x"
kind    = "pypi"
path    = "."
paths   = ["**"]
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
paths   = ["**"]
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
paths   = ["**"]
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
paths   = ["**"]
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
paths   = ["**"]
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

/* ----------------------- #189: trust_policy block ----------------------- */

describe('parseConfig: trust_policy', () => {
  const WITH_TRUST = `
[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "crates"
path  = "packages/rust"
paths = ["packages/rust/**"]
[package.trust_policy]
workflow    = "release.yml"
environment = "release"
repository  = "octo/hello"
`;

  it('accepts a valid [package.trust_policy] block', () => {
    const cfg = parseConfig(WITH_TRUST);
    expect(cfg.packages[0]!.trust_policy).toEqual({
      workflow: 'release.yml',
      environment: 'release',
      repository: 'octo/hello',
    });
  });

  it('accepts workflow alone (environment + repository optional)', () => {
    const cfg = parseConfig(
      WITH_TRUST.replace(/environment[^\n]*\n/, '').replace(/repository[^\n]*\n/, ''),
    );
    expect(cfg.packages[0]!.trust_policy?.workflow).toBe('release.yml');
    expect(cfg.packages[0]!.trust_policy?.environment).toBeUndefined();
  });

  it('rejects a path-shaped workflow value', () => {
    const bad = WITH_TRUST.replace('"release.yml"', '".github/workflows/release.yml"');
    expect(() => parseConfig(bad)).toThrow(/bare filename/);
  });

  it('rejects a repository without a slash', () => {
    const bad = WITH_TRUST.replace('"octo/hello"', '"just-a-name"');
    expect(() => parseConfig(bad)).toThrow(/owner\/repo/);
  });

  it('rejects unknown keys via .strict()', () => {
    const bad = WITH_TRUST + 'work_flow = "typo.yml"\n';
    expect(() => parseConfig(bad)).toThrow();
  });
});

/* --------------------- #216: build_workflow field --------------------- */

describe('parseConfig: build_workflow (#216)', () => {
  const WITH_BW = `
[putitoutthere]
version = 1

[[package]]
name = "my-py"
kind = "pypi"
path = "packages/python"
paths = ["packages/python/**"]
build_workflow = "publish-python.yml"
`;

  it('accepts a bare-filename build_workflow', () => {
    const cfg = parseConfig(WITH_BW);
    expect((cfg.packages[0] as { build_workflow?: string }).build_workflow).toBe(
      'publish-python.yml',
    );
  });

  it('is optional (absent when unset)', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1

[[package]]
name = "vanilla"
kind = "npm"
path = "."
paths = ["**"]
`);
    expect((cfg.packages[0] as { build_workflow?: string }).build_workflow).toBeUndefined();
  });

  it('rejects a path-shaped value (forward slash)', () => {
    const bad = WITH_BW.replace('"publish-python.yml"', '".github/workflows/publish-python.yml"');
    expect(() => parseConfig(bad)).toThrow(/bare filename/);
  });

  it('rejects a path-shaped value (backslash)', () => {
    const bad = WITH_BW.replace('"publish-python.yml"', '"sub\\\\publish.yml"');
    expect(() => parseConfig(bad)).toThrow(/bare filename/);
  });

  it('rejects an empty string', () => {
    const bad = WITH_BW.replace('"publish-python.yml"', '""');
    expect(() => parseConfig(bad)).toThrow();
  });

  it('works on every kind (crates, pypi, npm)', () => {
    const cfg = parseConfig(`
[putitoutthere]
version = 1

[[package]]
name = "a-crate"
kind = "crates"
path = "crates/a"
paths = ["crates/a/**"]
build_workflow = "publish-crate.yml"

[[package]]
name = "a-py"
kind = "pypi"
path = "py/a"
paths = ["py/a/**"]
build_workflow = "publish-python.yml"

[[package]]
name = "a-npm"
kind = "npm"
path = "packages/a"
paths = ["packages/a/**"]
build_workflow = "publish-npm.yml"
`);
    for (const p of cfg.packages) {
      expect((p as { build_workflow?: string }).build_workflow).toMatch(/^publish-.+\.yml$/);
    }
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
paths = ["py/my-py/**"]
build = "maturin"
targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]

[package.bundle_cli]
bin = "my-cli"
stage_to = "src/my_py/_binary"
crate_path = "crates/my-rust"
`;

  it('accepts a complete [package.bundle_cli] block', () => {
    const cfg = parseConfig(WITH_BUNDLE);
    const pkg = cfg.packages[0] as { bundle_cli?: { bin: string; stage_to: string; crate_path: string } };
    expect(pkg.bundle_cli).toEqual({
      bin: 'my-cli',
      stage_to: 'src/my_py/_binary',
      crate_path: 'crates/my-rust',
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
paths = ["packages/my-pkg/**"]

[package.bundle_cli]
bin = "my-cli"
stage_to = "bin"
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
paths = ["py/cachetta/**"]
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
paths = ["**"]
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
paths = ["**"]
`),
    ).toThrow(/upload-artifact|forbidden|registry-safe/);
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

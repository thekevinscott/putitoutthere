import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFlags, run } from './cli.js';

describe('cli', () => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  beforeEach(() => {
    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints a short --help hint and exits 1 with no command (#150)', async () => {
    const code = await run(['node', 'putitoutthere']);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/missing command/);
    expect(stderrChunks.join('')).toMatch(/--help/);
  });

  it('prints usage and exits 0 for --help', async () => {
    const code = await run(['node', 'putitoutthere', '--help']);
    expect(code).toBe(0);
    expect(stderrChunks.join('')).toMatch(/Usage:/);
  });

  it('--help description for --json is not stale (#231)', async () => {
    // Regression guard: the usage line for --json once read "(plan only)",
    // but the flag has been accepted on every command that emits a result
    // since their respective additions. Lock the corrected wording in so
    // a future edit can't quietly reintroduce the bug.
    const code = await run(['node', 'putitoutthere', '--help']);
    expect(code).toBe(0);
    const usage = stderrChunks.join('');
    expect(usage).toMatch(/--json\s+emit machine-readable output/);
    expect(usage).not.toMatch(/--json[^\n]*plan only/);
  });

  it('prints version from package.json', async () => {
    const code = await run(['node', 'putitoutthere', 'version']);
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toMatch(/putitoutthere \d+\.\d+\.\d+/);
  });

  it('exits 1 on unknown command', async () => {
    const code = await run(['node', 'putitoutthere', 'foo']);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/unknown command/);
  });

  it('`check` exits 1 with a finding list when config is missing (#319)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-check-'));
    try {
      const code = await run(['node', 'putitoutthere', 'check', '--cwd', tmp]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/check: 1 finding/);
      expect(stderrChunks.join('')).toMatch(/putitoutthere\.toml not found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('`check` exits 0 with a "no findings" line when config is well-formed', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-check-ok-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp });
      execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: tmp });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: tmp });
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmp });
      mkdirSync(join(tmp, 'pkg'), { recursive: true });
      writeFileSync(join(tmp, 'pkg/index.ts'), 'x');
      writeFileSync(
        join(tmp, 'pkg/package.json'),
        JSON.stringify({
          name: 'lib',
          version: '0.0.0',
          repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
        }),
      );
      writeFileSync(
        join(tmp, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name  = "lib"
kind  = "npm"
path  = "pkg"
globs = ["pkg/**"]
`,
      );
      execFileSync('git', ['add', '-A'], { cwd: tmp });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: tmp });

      const code = await run(['node', 'putitoutthere', 'check', '--cwd', tmp]);
      expect(code).toBe(0);
      expect(stdoutChunks.join('')).toMatch(/no findings/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('`check --json` emits the findings array on stdout', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cli-check-json-'));
    try {
      const code = await run(['node', 'putitoutthere', 'check', '--cwd', tmp, '--json']);
      expect(code).toBe(1);
      const parsed = JSON.parse(stdoutChunks.join('').trim()) as {
        findings: Array<{ message: string }>;
      };
      expect(parsed.findings.length).toBeGreaterThan(0);
      expect(parsed.findings[0]!.message).toMatch(/putitoutthere\.toml/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('surfaces errors with a non-zero exit and a friendly message', async () => {
    const code = await run(['node', 'putitoutthere', 'plan', '--cwd', '/path/that/does/not/exist']);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/^putitoutthere:/m);
  });

  it('resolves a relative --cwd to an absolute path (#244)', () => {
    // Downstream handlers run subprocesses with `cwd: ctx.cwd` and pass
    // file paths derived from `join(cwd, 'artifacts', ...)`. If the parsed
    // cwd were left relative, those paths would re-resolve under the
    // subprocess's cwd and double-up the prefix. Anchor at parse time.
    const flags = parseFlags(['--cwd', 'fixture-tree']);
    expect(isAbsolute(flags.cwd)).toBe(true);
    expect(flags.cwd.endsWith('fixture-tree')).toBe(true);
  });

  it('leaves an absolute --cwd untouched', () => {
    const flags = parseFlags(['--cwd', '/tmp/abs-path-test']);
    expect(flags.cwd).toBe('/tmp/abs-path-test');
  });

  it('parses --release-packages', () => {
    const flags = parseFlags(['--release-packages', 'lib-core@minor, lib-js']);
    expect(flags.releasePackages).toBe('lib-core@minor, lib-js');
  });

  it('leaves releasePackages undefined when --release-packages is absent', () => {
    const flags = parseFlags(['--cwd', '/tmp/x']);
    expect(flags.releasePackages).toBeUndefined();
  });
});

describe('cli: plan', () => {
  let repo: string;

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'cli-plan-'));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);

    mkdirSync(join(repo, 'packages/ts'), { recursive: true });
    writeFileSync(
      join(repo, 'putitoutthere.toml'),
      `[putitoutthere]
version = 1
[[package]]
name  = "demo"
kind  = "npm"
path  = "packages/ts"
globs = ["packages/ts/**"]
`,
      'utf8',
    );
    writeFileSync(join(repo, 'packages/ts/index.ts'), 'x', 'utf8');
    git(['add', '-A']);
    git(['commit', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('prints a human summary by default', async () => {
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const code = await run(['node', 'putitoutthere', 'plan', '--cwd', repo]);
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toMatch(/demo/);
  });

  it('emits JSON on --json', async () => {
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const code = await run(['node', 'putitoutthere', 'plan', '--cwd', repo, '--json']);
    expect(code).toBe(0);
    const out = stdoutChunks.join('').trim();
    const parsed = JSON.parse(out) as Array<{ name: string }>;
    expect(parsed.map((r) => r.name)).toContain('demo');
  });

  it('honors --release-packages, planning only the named package', async () => {
    // Tag `demo` so a manual bump has a base version. No new commit
    // lands after the tag — the manual path must release it anyway.
    git(['tag', 'demo-v1.0.0']);
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const code = await run([
      'node', 'putitoutthere', 'plan', '--cwd', repo, '--json',
      '--release-packages', 'demo@minor',
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutChunks.join('').trim()) as Array<{
      name: string;
      version: string;
    }>;
    expect(parsed.map((r) => r.name)).toEqual(['demo']);
    expect(parsed[0]!.version).toBe('1.1.0');
  });

  it('appends to $GITHUB_OUTPUT when set', async () => {
    const outFile = join(repo, 'gha-output.txt');
    writeFileSync(outFile, '', 'utf8');
    process.env.GITHUB_OUTPUT = outFile;

    const code = await run(['node', 'putitoutthere', 'plan', '--cwd', repo, '--json']);
    expect(code).toBe(0);
    const out = readFileSync(outFile, 'utf8');
    expect(out).toMatch(/^matrix=/);

    delete process.env.GITHUB_OUTPUT;
  });

  it('does NOT write matrix= to $GITHUB_OUTPUT when the plan is empty (#146)', async () => {
    // Force an empty plan via a `release: skip` trailer.
    git(['commit', '--allow-empty', '-m', 'nop\n\nrelease: skip']);
    const outFile = join(repo, 'gha-output-empty.txt');
    writeFileSync(outFile, '', 'utf8');
    process.env.GITHUB_OUTPUT = outFile;

    const code = await run(['node', 'putitoutthere', 'plan', '--cwd', repo, '--json']);
    expect(code).toBe(0);
    const out = readFileSync(outFile, 'utf8');
    expect(out).toBe('');

    delete process.env.GITHUB_OUTPUT;
  });

  it('prints "no packages to release" when plan is empty', async () => {
    // Commit a release: skip trailer to force empty plan.
    git(['commit', '--allow-empty', '-m', 'nop\n\nrelease: skip']);
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run(['node', 'putitoutthere', 'plan', '--cwd', repo]);
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toMatch(/no packages to release/);
  });

  it('throws when --dry-run is passed (removed in #244)', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run([
      'node',
      'putitoutthere',
      'publish',
      '--cwd',
      repo,
      '--dry-run',
    ]);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/--dry-run was removed/);
  });

  it('write-version: rejects a static [project].version literal with PIOT_PYPI_STATIC_VERSION (#333)', async () => {
    // After #333, pyproject.toml must declare `dynamic = ["version"]`.
    // The CLI subcommand mirrors the preflight rejection so a direct
    // invocation against a misconfigured tree surfaces the actionable
    // error rather than building an under-versioned artifact.
    const dir = mkdtempSync(join(tmpdir(), 'write-version-static-rejected-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        ['[project]', 'name = "demo"', 'version = "0.1.0"', ''].join('\n'),
        'utf8',
      );
      const stderrChunks: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run([
        'node',
        'putitoutthere',
        'write-version',
        '--path',
        dir,
        '--version',
        '0.2.8',
      ]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/PIOT_PYPI_STATIC_VERSION/);
      // pyproject.toml must not have been mutated by the failed call.
      expect(readFileSync(join(dir, 'pyproject.toml'), 'utf8')).toContain('version = "0.1.0"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: bumps Cargo.toml when pyproject declares dynamic = ["version"] (#276)', async () => {
    // Maturin's dynamic-version mode reads [package].version from the
    // sibling Cargo.toml. When pyproject opts into that, the bump
    // target shifts from pyproject to Cargo.toml; pyproject is left
    // untouched.
    const dir = mkdtempSync(join(tmpdir(), 'write-version-dynamic-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        ['[project]', 'name = "demo"', 'dynamic = ["version"]', ''].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(dir, 'Cargo.toml'),
        ['[package]', 'name = "demo"', 'version = "0.1.0"', 'edition = "2021"', ''].join('\n'),
        'utf8',
      );
      const before = readFileSync(join(dir, 'pyproject.toml'), 'utf8');
      const code = await run([
        'node',
        'putitoutthere',
        'write-version',
        '--path',
        dir,
        '--version',
        '0.2.8',
      ]);
      expect(code).toBe(0);
      expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).toContain('version = "0.2.8"');
      // pyproject was the dispatch input; its content must not change.
      expect(readFileSync(join(dir, 'pyproject.toml'), 'utf8')).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: errors when pyproject is dynamic but Cargo.toml is missing (#276)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-version-no-cargo-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        ['[project]', 'name = "demo"', 'dynamic = ["version"]', ''].join('\n'),
        'utf8',
      );
      const stderrChunks: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run([
        'node',
        'putitoutthere',
        'write-version',
        '--path',
        dir,
        '--version',
        '0.2.8',
      ]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/Cargo\.toml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: errors when pyproject.toml is missing (#276)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-version-no-pyproject-'));
    try {
      const stderrChunks: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run([
        'node',
        'putitoutthere',
        'write-version',
        '--path',
        dir,
        '--version',
        '0.2.8',
      ]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/pyproject\.toml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: errors when pyproject.toml is malformed (#276)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-version-malformed-'));
    try {
      writeFileSync(join(dir, 'pyproject.toml'), '[project\nbroken = ', 'utf8');
      const stderrChunks: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run([
        'node',
        'putitoutthere',
        'write-version',
        '--path',
        dir,
        '--version',
        '0.2.8',
      ]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/parse|pyproject\.toml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: errors when pyproject.toml has no [project] table (#276)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-version-no-project-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        '[build-system]\nrequires = ["setuptools"]\n',
        'utf8',
      );
      const stderrChunks: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run([
        'node',
        'putitoutthere',
        'write-version',
        '--path',
        dir,
        '--version',
        '0.2.8',
      ]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/\[project\]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: errors when --version is missing (#276)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-version-no-version-'));
    try {
      const stderrChunks: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run([
        'node',
        'putitoutthere',
        'write-version',
        '--path',
        dir,
      ]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/--version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-crate-version: rewrites Cargo.toml [package].version (#366)', async () => {
    // `_matrix.yml`'s npm bundled-cli path invokes
    // `command: write-crate-version` against the cross-compiled crate
    // so `cargo build` bakes the planned version into the binary.
    const dir = mkdtempSync(join(tmpdir(), 'cli-write-crate-version-'));
    try {
      writeFileSync(
        join(dir, 'Cargo.toml'),
        ['[package]', 'name = "dirsql"', 'version = "0.2.7"', 'edition = "2021"', ''].join('\n'),
        'utf8',
      );
      const code = await run([
        'node',
        'putitoutthere',
        'write-crate-version',
        '--path',
        dir,
        '--version',
        '0.3.5',
      ]);
      expect(code).toBe(0);
      expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).toContain('version = "0.3.5"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-crate-version: resolves a relative --path against --cwd (#366)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-write-crate-version-rel-'));
    try {
      const crate = join(root, 'crate');
      mkdirSync(crate);
      writeFileSync(
        join(crate, 'Cargo.toml'),
        ['[package]', 'name = "dirsql"', 'version = "0.2.7"', ''].join('\n'),
        'utf8',
      );
      const code = await run([
        'node',
        'putitoutthere',
        'write-crate-version',
        '--cwd',
        root,
        '--path',
        'crate',
        '--version',
        '0.3.5',
      ]);
      expect(code).toBe(0);
      expect(readFileSync(join(crate, 'Cargo.toml'), 'utf8')).toContain('version = "0.3.5"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('write-crate-version: errors when --path is missing (#366)', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run(['node', 'putitoutthere', 'write-crate-version', '--version', '0.3.5']);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/--path/);
  });

  it('write-crate-version: errors when --version is missing (#366)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-write-crate-version-no-version-'));
    try {
      const stderrChunks: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run(['node', 'putitoutthere', 'write-crate-version', '--path', dir]);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/--version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-launcher: writes bin/<bin>.js + updates package.json#bin for a bundled-cli npm package (#299)', async () => {
    // The matrix's main row invokes `command: write-launcher` so the
    // engine authors the per-platform launcher consumers used to have
    // to write by hand. Mirrors the write-version invocation shape:
    // `working_directory: ${{ matrix.path }}` flows through as `--path`.
    const tree = mkdtempSync(join(tmpdir(), 'cli-write-launcher-'));
    try {
      mkdirSync(join(tree, 'packages/ts'), { recursive: true });
      writeFileSync(
        join(tree, 'packages/ts/package.json'),
        JSON.stringify({ name: 'demo-cli', version: '0.0.0' }, null, 2),
      );
      writeFileSync(
        join(tree, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name = "demo-cli"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
build = "bundled-cli"
targets = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"]
[package.bundle_cli]
bin = "demo-cli"
crate_path = "."
`,
      );

      const code = await run([
        'node',
        'putitoutthere',
        'write-launcher',
        '--cwd',
        tree,
        '--path',
        'packages/ts',
      ]);
      expect(code).toBe(0);
      const launcher = readFileSync(
        join(tree, 'packages/ts/bin/demo-cli.js'),
        'utf8',
      );
      expect(launcher).toContain('`demo-cli-${triple}`');
      const pkg = JSON.parse(
        readFileSync(join(tree, 'packages/ts/package.json'), 'utf8'),
      ) as { bin?: Record<string, string> };
      expect(pkg.bin).toEqual({ 'demo-cli': 'bin/demo-cli.js' });
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('write-launcher: no-op for an npm vanilla package (no bundled-cli entry) (#299)', async () => {
    const tree = mkdtempSync(join(tmpdir(), 'cli-write-launcher-noop-'));
    try {
      mkdirSync(join(tree, 'packages/ts'), { recursive: true });
      writeFileSync(
        join(tree, 'packages/ts/package.json'),
        JSON.stringify({ name: 'demo', version: '0.0.0' }, null, 2),
      );
      writeFileSync(
        join(tree, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name = "demo"
kind = "npm"
path = "packages/ts"
globs = ["packages/ts/**"]
`,
      );

      const code = await run([
        'node',
        'putitoutthere',
        'write-launcher',
        '--cwd',
        tree,
        '--path',
        'packages/ts',
      ]);
      expect(code).toBe(0);
      // No launcher was authored; no `bin` field was added.
      const pkg = JSON.parse(
        readFileSync(join(tree, 'packages/ts/package.json'), 'utf8'),
      ) as { bin?: unknown };
      expect(pkg.bin).toBeUndefined();
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('publish exits 1 with PIOT_PUBLISH_EMPTY_PLAN when the plan is empty', async () => {
    // Invariant: if `publish` runs, something publishes. An empty
    // plan at this stage is a workflow-gate / engine-state bug and
    // surfaces as a non-zero exit with a fingerprintable code.
    git(['commit', '--allow-empty', '-m', 'nop\n\nrelease: skip']);
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run([
      'node',
      'putitoutthere',
      'publish',
      '--cwd',
      repo,
    ]);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/PIOT_PUBLISH_EMPTY_PLAN/);
  });
});

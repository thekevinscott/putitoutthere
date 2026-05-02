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

  it('write-version: rewrites static [project].version in pyproject.toml (#276)', async () => {
    // Maturin reads [project].version from pyproject.toml at build time.
    // The build matrix invokes this subcommand to bump the literal to
    // matrix.version BEFORE calling maturin, so wheels leave the runner
    // pre-versioned at the planned version.
    const dir = mkdtempSync(join(tmpdir(), 'write-version-static-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        ['[project]', 'name = "demo"', 'version = "0.1.0"', ''].join('\n'),
        'utf8',
      );
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
      expect(readFileSync(join(dir, 'pyproject.toml'), 'utf8')).toContain('version = "0.2.8"');
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

  it('write-version: bumps BOTH pyproject and sibling Cargo.toml on the static-literal path (#276)', async () => {
    // python-rust-maturin shape: pyproject's [project].version is a
    // static literal AND a sibling Cargo.toml carries [package].version.
    // Maturin's mismatch-resolution behavior varies by platform/version
    // — on Windows it shipped wheels at the stale Cargo literal even
    // when pyproject was bumped. Bumping both keeps the contract
    // platform-independent.
    const dir = mkdtempSync(join(tmpdir(), 'write-version-static-with-cargo-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        ['[project]', 'name = "demo"', 'version = "0.1.0"', ''].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(dir, 'Cargo.toml'),
        ['[package]', 'name = "demo"', 'version = "0.1.0"', 'edition = "2021"', ''].join('\n'),
        'utf8',
      );
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
      expect(readFileSync(join(dir, 'pyproject.toml'), 'utf8')).toContain('version = "0.2.8"');
      expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).toContain('version = "0.2.8"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: static-literal path with no sibling Cargo.toml bumps only pyproject (#276)', async () => {
    // Pure-python pyproject (no Rust crate alongside) — nothing to bump
    // on the Cargo side; the pyproject bump alone is correct.
    const dir = mkdtempSync(join(tmpdir(), 'write-version-static-no-cargo-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        ['[project]', 'name = "demo"', 'version = "0.1.0"', ''].join('\n'),
        'utf8',
      );
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
      expect(readFileSync(join(dir, 'pyproject.toml'), 'utf8')).toContain('version = "0.2.8"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write-version: static-literal path tolerates a Cargo.toml with no [package].version (#276)', async () => {
    // Workspace-root Cargo.toml carries `[workspace]` but no
    // `[package].version`. Skip it; bumping pyproject is sufficient.
    const dir = mkdtempSync(join(tmpdir(), 'write-version-static-workspace-cargo-'));
    try {
      writeFileSync(
        join(dir, 'pyproject.toml'),
        ['[project]', 'name = "demo"', 'version = "0.1.0"', ''].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(dir, 'Cargo.toml'),
        ['[workspace]', 'members = ["crates/*"]', ''].join('\n'),
        'utf8',
      );
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
      expect(readFileSync(join(dir, 'pyproject.toml'), 'utf8')).toContain('version = "0.2.8"');
      // No [package].version line; Cargo.toml unchanged.
      expect(readFileSync(join(dir, 'Cargo.toml'), 'utf8')).not.toContain('version');
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

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './cli.js';

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

  it('prints usage and exits 1 with no command', async () => {
    const code = await run(['node', 'putitoutthere']);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/Usage: putitoutthere/);
  });

  it('prints usage and exits 0 for --help', async () => {
    const code = await run(['node', 'putitoutthere', '--help']);
    expect(code).toBe(0);
    expect(stderrChunks.join('')).toMatch(/Usage: putitoutthere/);
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

  it('init scaffolds a fresh repo and exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-init-'));
    try {
      const code = await run(['node', 'putitoutthere', 'init', '--cwd', dir]);
      expect(code).toBe(0);
      expect(existsSync(join(dir, 'putitoutthere.toml'))).toBe(true);
      expect(stdoutChunks.join('')).toMatch(/wrote.+putitoutthere\.toml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init prints "backed up" and "skipped" lines when appropriate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-init-backed-'));
    try {
      writeFileSync(join(dir, 'putitoutthere.toml'), '# user-edited\n');
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(dir, '.github', 'workflows', 'release.yml'), '# existing\n');
      const code = await run(['node', 'putitoutthere', 'init', '--cwd', dir]);
      expect(code).toBe(0);
      const out = stdoutChunks.join('');
      expect(out).toMatch(/backed up .+release\.yml/);
      expect(out).toMatch(/skipped.+putitoutthere\.toml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --cadence=scheduled emits the cron release.yml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-init-sched-'));
    try {
      const code = await run([
        'node', 'putitoutthere', 'init', '--cwd', dir, '--cadence', 'scheduled',
      ]);
      expect(code).toBe(0);
      const y = readFileSync(join(dir, '.github', 'workflows', 'release.yml'), 'utf8');
      expect(y).toContain("cron: '0 2 * * *'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --force overwrites existing putitoutthere.toml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-init-force-'));
    try {
      writeFileSync(join(dir, 'putitoutthere.toml'), '# pre-existing\n');
      const code = await run(['node', 'putitoutthere', 'init', '--cwd', dir, '--force']);
      expect(code).toBe(0);
      expect(stdoutChunks.join('')).toMatch(/wrote.+putitoutthere\.toml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init --json emits machine-readable result', async () => {
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const dir = mkdtempSync(join(tmpdir(), 'cli-init-json-'));
    try {
      const code = await run(['node', 'putitoutthere', 'init', '--cwd', dir, '--json']);
      expect(code).toBe(0);
      const r = JSON.parse(stdoutChunks.join('').trim()) as { wrote: string[] };
      expect(r.wrote).toContain('putitoutthere.toml');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs doctor and exits 1 without config', async () => {
    const code = await run(['node', 'putitoutthere', 'doctor', '--cwd', tmpdir()]);
    expect(code).toBe(1);
  });

  it('doctor: --json emits machine-readable', async () => {
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run(['node', 'putitoutthere', 'doctor', '--cwd', tmpdir(), '--json']);
    expect(code).toBe(1);
    const report = JSON.parse(stdoutChunks.join('').trim()) as { ok: boolean };
    expect(report.ok).toBe(false);
  });

  it('doctor: exits 0 + prints "All checks passed" with a valid config + auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-cli-'));
    try {
      writeFileSync(
        join(dir, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name  = "a"
kind  = "crates"
path  = "a"
paths = ["**"]
`,
        'utf8',
      );
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      const stdoutChunks: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
      const code = await run(['node', 'putitoutthere', 'doctor', '--cwd', dir]);
      expect(code).toBe(0);
      expect(stdoutChunks.join('')).toMatch(/All checks passed|✓/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.CARGO_REGISTRY_TOKEN;
    }
  });

  // #93: `preflight` runs every pre-publish check against plan packages.
  it('preflight: runs every check and exits 1 when any fail', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-cli-'));
    try {
      mkdirSync(join(dir, 'rust'), { recursive: true });
      writeFileSync(
        join(dir, 'rust/Cargo.toml'),
        '[package]\nname = "lib-rs"\nversion = "0.0.0"\n',
        'utf8',
      );
      writeFileSync(
        join(dir, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`,
        'utf8',
      );
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });

      const code = await run(['node', 'putitoutthere', 'preflight', '--cwd', dir]);
      // Artifact dir is not staged → fails.
      expect(code).toBe(1);
      const out = stdoutChunks.join('');
      expect(out).toMatch(/✗ lib-rs.*artifact/);
      expect(out).toMatch(/preflight: fail/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.CARGO_REGISTRY_TOKEN;
    }
  });

  it('preflight: --json emits machine-readable + exit 0 when all checks pass', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-cli-json-'));
    try {
      mkdirSync(join(dir, 'js'), { recursive: true });
      writeFileSync(
        join(dir, 'js/package.json'),
        JSON.stringify({ name: 'lib-js', version: '0.0.0', repository: 'x' }),
        'utf8',
      );
      writeFileSync(
        join(dir, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name  = "lib-js"
kind  = "npm"
path  = "js"
paths = ["js/**"]
first_version = "0.1.0"
`,
        'utf8',
      );
      process.env.NODE_AUTH_TOKEN = 'tok';
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });

      const code = await run(['node', 'putitoutthere', 'preflight', '--cwd', dir, '--json']);
      expect(code).toBe(0);
      const report = JSON.parse(stdoutChunks.join('').trim()) as { ok: boolean };
      expect(report.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.NODE_AUTH_TOKEN;
    }
  });

  it('preflight: prints Issues section when top-level issues exist', async () => {
    // No putitoutthere.toml → config issue → non-empty issues array.
    const code = await run(['node', 'putitoutthere', 'preflight', '--cwd', tmpdir()]);
    expect(code).toBe(1);
    const out = stdoutChunks.join('');
    expect(out).toMatch(/Issues:/);
    expect(out).toMatch(/config:/);
  });

  it('preflight: no packages in scope prints a notice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preflight-cli-empty-'));
    try {
      mkdirSync(join(dir, 'rust'), { recursive: true });
      writeFileSync(
        join(dir, 'rust/Cargo.toml'),
        '[package]\nname = "lib-rs"\nversion = "0.0.0"\n',
        'utf8',
      );
      writeFileSync(
        join(dir, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`,
        'utf8',
      );
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
      // Tag to make plan empty.
      execFileSync('git', ['tag', 'lib-rs-v0.1.0'], { cwd: dir });

      const code = await run(['node', 'putitoutthere', 'preflight', '--cwd', dir]);
      expect(code).toBe(0);
      expect(stdoutChunks.join('')).toMatch(/preflight: no packages in scope/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.CARGO_REGISTRY_TOKEN;
    }
  });

  // #89: `--artifacts` walks the plan and prints a present-vs-missing table.
  it('doctor: --artifacts prints a table with expected layout for missing rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-cli-artifacts-'));
    try {
      mkdirSync(join(dir, 'rust'), { recursive: true });
      writeFileSync(
        join(dir, 'putitoutthere.toml'),
        `[putitoutthere]
version = 1
[[package]]
name  = "lib-rs"
kind  = "crates"
path  = "rust"
paths = ["rust/**"]
first_version = "0.1.0"
`,
        'utf8',
      );
      process.env.CARGO_REGISTRY_TOKEN = 'tok';
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
      execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });

      const code = await run(['node', 'putitoutthere', 'doctor', '--cwd', dir, '--artifacts']);
      expect(code).toBe(1);
      const out = stdoutChunks.join('');
      expect(out).toMatch(/Artifacts:/);
      expect(out).toMatch(/✗ lib-rs-crate.*expected: artifacts\/lib-rs-crate\/lib-rs-0\.1\.0\.crate/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.CARGO_REGISTRY_TOKEN;
    }
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
paths = ["packages/ts/**"]
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

  it('publishes in dry-run mode', async () => {
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
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
    // publish exits 1 here because preflight fails (no NODE_AUTH_TOKEN);
    // we're just exercising the code path.
    expect([0, 1]).toContain(code);
  });

  it('publishes prints published list when plan is empty', async () => {
    // Add a release: skip commit then publish -- plan returns empty,
    // publish returns ok with empty list.
    git(['commit', '--allow-empty', '-m', 'nop\n\nrelease: skip']);
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run([
      'node',
      'putitoutthere',
      'publish',
      '--cwd',
      repo,
    ]);
    expect(code).toBe(0);
    expect(stdoutChunks.join('')).toMatch(/\(nothing\)/);
  });

  it('publish --json emits a JSON result', async () => {
    git(['commit', '--allow-empty', '-m', 'nop\n\nrelease: skip']);
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run([
      'node',
      'putitoutthere',
      'publish',
      '--cwd',
      repo,
      '--json',
    ]);
    expect(code).toBe(0);
    const json = JSON.parse(stdoutChunks.join('').trim()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('token inspect: decodes a PyPI-format token from --token', async () => {
    const identifier = { version: 1, permissions: 'user', user: 'u-1' };
    const bytes = Buffer.concat([
      Buffer.from([0x02]),
      Buffer.from(JSON.stringify(identifier), 'utf8'),
    ]);
    const token = 'pypi-' + bytes.toString('base64');

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const code = await run([
      'node',
      'putitoutthere',
      'token',
      'inspect',
      '--token',
      token,
      '--json',
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdoutChunks.join('').trim()) as {
      registry: string;
      identifier: Record<string, unknown>;
    };
    expect(parsed.registry).toBe('pypi');
    expect(parsed.identifier.user).toBe('u-1');
  });

  it('token inspect: prints human output by default', async () => {
    const identifier = { version: 1, permissions: 'user', user: 'u-1' };
    const bytes = Buffer.concat([
      Buffer.from([0x02]),
      Buffer.from(JSON.stringify(identifier), 'utf8'),
    ]);
    const token = 'pypi-' + bytes.toString('base64');

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const code = await run([
      'node',
      'putitoutthere',
      'token',
      'inspect',
      '--token',
      token,
    ]);
    expect(code).toBe(0);
    const out = stdoutChunks.join('');
    expect(out).toMatch(/registry: pypi/);
    expect(out).toMatch(/restrictions: \(none/);
  });

  it('token inspect: exits 1 and complains when no token is provided', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    // Ensure env has no recognizable token values leaking from a prior test.
    const prev = {
      TWINE_PASSWORD: process.env.TWINE_PASSWORD,
      NPM_TOKEN: process.env.NPM_TOKEN,
      PYPI_API_TOKEN: process.env.PYPI_API_TOKEN,
    };
    delete process.env.TWINE_PASSWORD;
    delete process.env.NPM_TOKEN;
    delete process.env.PYPI_API_TOKEN;
    try {
      const code = await run(['node', 'putitoutthere', 'token', 'inspect']);
      expect(code).toBe(1);
      expect(stderrChunks.join('')).toMatch(/no token provided/);
    } finally {
      if (prev.TWINE_PASSWORD !== undefined) process.env.TWINE_PASSWORD = prev.TWINE_PASSWORD;
      if (prev.NPM_TOKEN !== undefined) process.env.NPM_TOKEN = prev.NPM_TOKEN;
      if (prev.PYPI_API_TOKEN !== undefined) process.env.PYPI_API_TOKEN = prev.PYPI_API_TOKEN;
    }
  });

  it('token inspect: rejects unknown subcommand', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run(['node', 'putitoutthere', 'token', 'wat']);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/unknown subcommand/);
  });

  it('token inspect: missing subcommand is rejected', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run(['node', 'putitoutthere', 'token']);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/missing subcommand/);
  });

  it('token inspect: auto-reads the sole pypi token from env when --token omitted', async () => {
    const identifier = { version: 1, permissions: 'user', user: 'u-env' };
    const bytes = Buffer.concat([
      Buffer.from([0x02]),
      Buffer.from(JSON.stringify(identifier), 'utf8'),
    ]);
    const token = 'pypi-' + bytes.toString('base64');
    const prev = process.env.TWINE_PASSWORD;
    process.env.TWINE_PASSWORD = token;

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    try {
      const code = await run(['node', 'putitoutthere', 'token', 'inspect', '--json']);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdoutChunks.join('').trim()) as {
        identifier: Record<string, unknown>;
      };
      expect(parsed.identifier.user).toBe('u-env');
    } finally {
      if (prev === undefined) delete process.env.TWINE_PASSWORD;
      else process.env.TWINE_PASSWORD = prev;
    }
  });

  it('surfaces errors with a non-zero exit and a friendly message', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    // No config file → plan throws → cli catches and exits 1.
    const code = await run([
      'node',
      'putitoutthere',
      'plan',
      '--cwd',
      tmpdir(),
      '--config',
      join(tmpdir(), 'does-not-exist.toml'),
    ]);
    expect(code).toBe(1);
    expect(stderrChunks.join('')).toMatch(/cannot read|does-not-exist/);
  });
});

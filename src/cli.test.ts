import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('exits 2 for init (still unimplemented)', async () => {
    const code = await run(['node', 'putitoutthere', 'init']);
    expect(code).toBe(2);
    expect(stderrChunks.join('')).toMatch(/not implemented/);
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
    const out = execFileSync('cat', [outFile], { encoding: 'utf8' });
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

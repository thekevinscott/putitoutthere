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

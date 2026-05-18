/**
 * `advance-v0.yml` invariant: every push to main builds the action
 * bundle, folds it into a tag-only commit, and force-moves the
 * floating `v0` tag to that commit.
 *
 * Why this exists: `release-npm.yml`'s "Move floating major tag" step
 * advances `v0` only when a `release:` trailer fires the publish job.
 * Commits that land on main without a trailer (test-only, docs, dep
 * bumps, internal refactors) leave `v0` stale relative to main. The
 * decision was to flip that contract: `v0` tracks main HEAD, not the
 * latest release. This workflow makes that contract enforceable.
 *
 * Constraint preserved: `v0` must point at a commit containing
 * `dist-action/index.js` so `uses: thekevinscott/putitoutthere@v0`
 * resolves to a runnable action. `dist-action/` is gitignored on main,
 * so a bundle commit is synthesized on top of HEAD (same pattern as
 * `release-npm.yml`'s Fold step) before the tag is moved.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const advanceWorkflow = join(repoRoot, '.github/workflows/advance-v0.yml');

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
}
interface WorkflowJob {
  steps?: WorkflowStep[];
  'runs-on'?: string;
  permissions?: Record<string, string>;
}
interface Workflow {
  on?: { push?: { branches?: string[] }; workflow_dispatch?: unknown };
  concurrency?: { group?: string };
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
}

function loadWorkflow(): Workflow {
  return parseYaml(readFileSync(advanceWorkflow, 'utf8')) as Workflow;
}

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

function initRepo(): void {
  repo = mkdtempSync(join(tmpdir(), 'advance-v0-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
}

beforeEach(() => {
  initRepo();
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('advance-v0.yml: every push to main advances v0 to a bundle commit', () => {
  it('workflow file exists', () => {
    expect(
      existsSync(advanceWorkflow),
      '.github/workflows/advance-v0.yml must exist',
    ).toBe(true);
  });

  it('triggers on push to main', () => {
    const wf = loadWorkflow();
    expect(wf.on?.push?.branches, 'must trigger on push to main').toContain('main');
  });

  it('grants contents: write permission for tag push', () => {
    const wf = loadWorkflow();
    // Either job-level or workflow-level is acceptable.
    const jobPerm = Object.values(wf.jobs ?? {})[0]?.permissions?.contents;
    const wfPerm = wf.permissions?.contents;
    expect(jobPerm === 'write' || wfPerm === 'write').toBe(true);
  });

  it('Fold step creates a bundle commit and forwards the parent body', () => {
    writeFileSync(join(repo, 'README.md'), 'hi\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'feat: bug fix\n\nbody line that must survive']);
    const parentSha = git(['rev-parse', 'HEAD']);

    // Stage a dist-action/ change so the script's diff --cached check
    // finds something to commit (mirrors the GHA runner state after
    // `pnpm run build:action`).
    mkdirSync(join(repo, 'dist-action'), { recursive: true });
    writeFileSync(join(repo, 'dist-action/index.js'), '// bundle\n', 'utf8');
    execFileSync('git', ['add', '-f', 'dist-action/'], { cwd: repo });

    const wf = loadWorkflow();
    const steps = wf.jobs?.advance?.steps ?? [];
    const fold = steps.find((s) => s.name === 'Fold action bundle into v0 commit');
    expect(fold, 'advance-v0.yml must have the Fold step').toBeDefined();
    expect(fold!.run, 'Fold step must declare a run script').toBeDefined();

    execFileSync('bash', ['-c', fold!.run!], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const headSha = git(['rev-parse', 'HEAD']);
    expect(headSha, 'Fold step must create a new commit on top of HEAD').not.toBe(
      parentSha,
    );
    expect(git(['rev-parse', 'HEAD^'])).toBe(parentSha);
    expect(git(['ls-files', '--stage', 'dist-action/index.js'])).toMatch(
      /dist-action\/index\.js/,
    );

    const headBody = git(['log', '-1', '--format=%B', 'HEAD']);
    expect(headBody).toMatch(/chore\(v0\): bundle action/);
    expect(headBody).toContain('body line that must survive');
  });

  it('Move step force-tags v0 at HEAD and pushes the tag', () => {
    writeFileSync(join(repo, 'a'), '1', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'one']);
    // Pre-existing v0 tag at a different commit — the step must force-move.
    git(['tag', 'v0', 'HEAD']);
    writeFileSync(join(repo, 'b'), '2', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'two']);
    const newHead = git(['rev-parse', 'HEAD']);

    const wf = loadWorkflow();
    const steps = wf.jobs?.advance?.steps ?? [];
    const move = steps.find((s) => s.name === 'Force-move v0 to bundle commit');
    expect(move, 'advance-v0.yml must have the Move step').toBeDefined();
    expect(move!.run, 'Move step must declare a run script').toBeDefined();

    // Static check: the script must push the tag with --force.
    expect(move!.run).toMatch(/git push --force origin .*v0/);

    // Execute the local-only portion (drop the push line — no remote).
    const localOnly = move!
      .run!.split('\n')
      .filter((line) => !line.trim().startsWith('git push'))
      .join('\n');
    execFileSync('bash', ['-c', localOnly], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(git(['rev-parse', 'v0'])).toBe(newHead);
  });
});

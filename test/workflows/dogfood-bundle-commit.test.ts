/**
 * Dogfood `release-npm.yml` bundle-commit invariant.
 *
 * The dogfood publish job creates a `chore(release): bundle action`
 * commit on top of HEAD before invoking `putitoutthere publish`, so
 * the release tag points at a commit that has `dist-action/` in it.
 * The bug: that bundle commit's body had no `release:` trailer and a
 * single parent — `resolveTrailer` (`src/plan.ts`) returns null, the
 * publish CLI's internal plan re-derivation defaults the bump to
 * `patch`, and the `release: minor` the operator wrote in the merge
 * commit silently downgrades. Symptom in the wild: 0.2.0 attempt
 * landed as 0.1.52 (commit b254e5e on main, dogfood run 25060900xxx).
 *
 * Fix: the workflow's Fold step forwards the parent commit's body
 * into the bundle commit so the trailer survives. This test asserts
 * that contract by extracting the actual run-script from the
 * shipped `release-npm.yml` and executing it against a fixture clone
 * — a regression test on the workflow itself, not on the engine.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { plan } from '../../src/plan.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = join(repoRoot, 'test/fixtures/js-vanilla');
const dogfoodWorkflow = join(repoRoot, '.github/workflows/release-npm.yml');

interface WorkflowStep {
  name?: string;
  run?: string;
}
interface WorkflowJob {
  steps?: WorkflowStep[];
}
interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trimEnd();
}

beforeEach(() => {
  // Clone js-vanilla fixture into a fresh temp repo, rewrite the
  // version placeholder, and tag an initial release so subsequent
  // commits diff against that tag (mirrors a post-bootstrap repo).
  repo = mkdtempSync(join(tmpdir(), 'dogfood-bundle-'));
  cpSync(fixtureRoot, repo, { recursive: true });
  const tomlPath = join(repo, 'putitoutthere.toml');
  writeFileSync(
    tomlPath,
    readFileSync(tomlPath, 'utf8').replaceAll('__VERSION__', '0.1.0'),
    'utf8',
  );
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: initial']);
  // Tag this commit as the prior release.
  git(['tag', 'piot-fixture-zzz-cli-v0.1.0']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('dogfood release-npm.yml: bundle commit preserves the release trailer', () => {
  it('plan reads `release: minor` after the Fold step adds the bundle commit on top', async () => {
    // Operator commits a glob-matching change with `release: minor`.
    writeFileSync(join(repo, 'src/index.ts'), 'export const x = 2;\n', 'utf8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'feat: bump\n\nrelease: minor']);

    // Sanity: pre-bundle plan reads minor → next version is 0.2.0.
    const before = await plan({ cwd: repo });
    expect(before).toHaveLength(1);
    expect(before[0]!.version).toBe('0.2.0');

    // Stage a `dist-action/` change so the script's
    // `git diff --cached --quiet` check passes (matches the dogfood
    // job, where the build step has already produced the bundle).
    mkdirSync(join(repo, 'dist-action'), { recursive: true });
    writeFileSync(join(repo, 'dist-action/index.js'), '// bundle\n', 'utf8');
    execFileSync('git', ['add', '-f', 'dist-action/'], { cwd: repo });

    // Read the dogfood workflow and extract the bundle-fold step's
    // run-script verbatim. Test fails RED if the step is absent or
    // the script is missing the trailer-forward; test goes GREEN
    // once the workflow is updated to forward the parent body.
    const wf = parseYaml(readFileSync(dogfoodWorkflow, 'utf8')) as Workflow;
    const publishSteps = wf.jobs?.publish?.steps ?? [];
    const foldStep = publishSteps.find(
      (s) => s.name === 'Fold action bundle into release commit',
    );
    expect(foldStep, 'release-npm.yml must have the Fold step').toBeDefined();
    const script = foldStep!.run;
    expect(script, 'Fold step must declare a run script').toBeDefined();

    // Execute the script as a single bash invocation (matches GHA
    // `run: |` block semantics with `shell: bash` default on Linux).
    execFileSync('bash', ['-c', script!], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // After the Fold step, HEAD is the new bundle commit. The
    // `release: minor` trailer the operator wrote on the parent
    // must survive into the new HEAD's body, otherwise the publish
    // CLI's internal plan re-derivation collapses the bump to
    // `patch` (the dogfood incident's failure mode).
    const headBody = git(['log', '-1', '--format=%B', 'HEAD']);
    expect(headBody).toMatch(/release:\s*minor/i);

    // End-to-end: a fresh `plan` call (the publish CLI's internal
    // re-derivation) reads HEAD's body, sees the trailer, and emits
    // the 0.2.0 row.
    const after = await plan({ cwd: repo });
    expect(after).toHaveLength(1);
    expect(after[0]!.version).toBe('0.2.0');
  });
});

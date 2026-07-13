/**
 * Composition root for the fixture-materialize harness (#447). Reads the phase
 * (argv) and FIXTURE / RUN_ID / RUN_ATTEMPT / FIXTURE_VERSION / GITHUB_ENV from
 * the env, performs the real I/O the three "Materialize fixture" bash blocks in
 * `.github/workflows/e2e-fixture-job.yml` performed — wipe + copy the fixture
 * tree, rewrite the manifest tokens, export FIXTURE_VERSION, init the throwaway
 * git repo — and returns the exit code. The only I/O lives here; the phase
 * decisions are `decide.ts`'s.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { applySubstitutions } from './apply-substitutions.js';
import { decideFixtureMaterialize, type FixtureMaterializeMode } from './decide.js';

// The manifest basenames the bash `find ... \( -name ... \)` matched. Only
// these files carry the `__VERSION__` / `-placeholder` tokens.
const MANIFEST_NAMES = ['putitoutthere.toml', 'package.json', 'Cargo.toml', 'pyproject.toml'];
const FIXTURE_TREE = 'fixture-tree';
const FIXTURES_ROOT = 'packages/engine/test/fixtures';

// The throwaway-repo git commands, in order, matching the bash exactly.
const GIT_STEPS: readonly (readonly string[])[] = [
  ['init', '-q', '-b', 'main'],
  ['config', 'user.email', 'e2e@putitoutthere.dev'],
  ['config', 'user.name', 'piot e2e'],
  ['config', 'commit.gpgsign', 'false'],
  ['config', 'tag.gpgsign', 'false'],
  ['add', '.'],
  ['commit', '-q', '-m', 'e2e: initial fixture'],
];

function isMode(value: string | undefined): value is FixtureMaterializeMode {
  return value === 'plan' || value === 'build' || value === 'publish';
}

export function runFixtureMaterialize(argv: readonly string[]): number {
  const mode = argv[3];
  if (!isMode(mode)) {
    process.stdout.write(
      `::error::fixture-materialize: mode must be one of plan|build|publish (got ${mode ?? '<none>'}).\n`,
    );
    return 1;
  }

  const fixture = process.env.FIXTURE;
  if (fixture === undefined || fixture === '') {
    process.stdout.write('::error::fixture-materialize: FIXTURE must be set.\n');
    return 1;
  }

  let version: string;
  if (mode === 'plan') {
    version = `0.0.${Math.floor(Date.now() / 1000)}`;
  } else if (mode === 'build') {
    version = '0.0.1';
  } else {
    const fromEnv = process.env.FIXTURE_VERSION;
    if (fromEnv === undefined || fromEnv === '') {
      process.stdout.write('::error::fixture-materialize: FIXTURE_VERSION must be set for the publish phase.\n');
      return 1;
    }
    version = fromEnv;
  }

  const plan = decideFixtureMaterialize({
    mode,
    fixture,
    version,
    runId: process.env.RUN_ID ?? '',
    runAttempt: process.env.RUN_ATTEMPT ?? '',
  });

  let githubEnv: string | undefined;
  if (plan.writeFixtureVersion) {
    githubEnv = process.env.GITHUB_ENV;
    if (githubEnv === undefined || githubEnv === '') {
      process.stdout.write('::error::fixture-materialize: GITHUB_ENV must be set for the plan phase.\n');
      return 1;
    }
  }

  rmSync(FIXTURE_TREE, { recursive: true, force: true });
  cpSync(join(FIXTURES_ROOT, fixture), FIXTURE_TREE, { recursive: true });

  if (githubEnv !== undefined) {
    appendFileSync(githubEnv, `FIXTURE_VERSION=${version}\n`);
  }

  for (const entry of readdirSync(FIXTURE_TREE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !MANIFEST_NAMES.includes(entry.name)) {
      continue;
    }
    const filePath = join(entry.parentPath, entry.name);
    writeFileSync(filePath, applySubstitutions(readFileSync(filePath, 'utf8'), plan.substitutions));
  }

  if (plan.gitInit) {
    for (const args of GIT_STEPS) {
      execFileSync('git', [...args], { cwd: FIXTURE_TREE, stdio: 'inherit' });
    }
  }

  return 0;
}

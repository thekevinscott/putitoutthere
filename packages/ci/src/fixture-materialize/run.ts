/**
 * Composition root for the fixture-materialize harness (#447). Performs the real
 * I/O the three "Materialize fixture" bash blocks in `e2e-fixture-job.yml` did —
 * wipe + copy the fixture tree, rewrite manifest tokens, export FIXTURE_VERSION,
 * init the throwaway git repo. The phase decisions are `decide.ts`'s.
 */

import { appendFile, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';

import { execInherit } from '../utils/exec-inherit.js';
import { applySubstitutions } from './apply-substitutions.js';
import { decideFixtureMaterialize, type FixtureMaterializeMode } from './decide.js';

// The manifest basenames the bash `find ... \( -name ... \)` matched. Only
// these files carry the `__VERSION__` / `-placeholder` tokens.
const MANIFEST_NAMES = ['putitoutthere.toml', 'package.json', 'Cargo.toml', 'pyproject.toml'];
const FIXTURE_TREE = 'fixture-tree';
const FIXTURES_ROOT = 'packages/engine/tests/fixtures';

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

export async function runFixtureMaterialize(argv: readonly string[]): Promise<number> {
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

  await rm(FIXTURE_TREE, { recursive: true, force: true });
  await cp(`${FIXTURES_ROOT}/${fixture}`, FIXTURE_TREE, { recursive: true });

  if (githubEnv !== undefined) {
    await appendFile(githubEnv, `FIXTURE_VERSION=${version}\n`);
  }

  for (const entry of await readdir(FIXTURE_TREE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !MANIFEST_NAMES.includes(entry.name)) {
      continue;
    }
    const filePath = `${entry.parentPath}/${entry.name}`;
    await writeFile(filePath, applySubstitutions(await readFile(filePath, 'utf8'), plan.substitutions));
  }

  if (plan.gitInit) {
    // Function-scoped (not a module constant, unlike MANIFEST_NAMES above):
    // the mutation gate's static-mutant detection never re-evaluates a
    // module-level initializer per mutant and false-survives it (mirrors
    // fixture-matrix's materialize-fixture.ts).
    //
    // A throwaway bare repo wired up as fixture-tree's `origin`. ensureTag's
    // remote-aware check (#717) runs `git ls-remote --tags origin`
    // unconditionally and throws without one, where a failed push used to
    // be silently warned.
    const fixtureOrigin = 'fixture-tree-origin.git';
    await rm(fixtureOrigin, { recursive: true, force: true });
    await execInherit('git', ['init', '--bare', '-q', fixtureOrigin]);
    const steps = [...GIT_STEPS, ['remote', 'add', 'origin', `../${fixtureOrigin}`]];
    for (const args of steps) {
      await execInherit('git', [...args], { cwd: FIXTURE_TREE });
    }
  }

  return 0;
}

/**
 * Composition root for `pypi-tag-verify prepare` — the step that tells the
 * e2e tag job what the PyPI upload shipped. The only I/O lives here; the
 * decision is `uploaded-expectations.ts`'s.
 *
 * The throwaway tree lives at `$TAG_TREE`, which the workflow points outside
 * the checkout (`${{ runner.temp }}/…`): a tree with no `.git` would let git
 * walk up and tag the real repository instead. No remote is added either, so
 * `ensureTag`'s push fails and is warned rather than reaching origin — the
 * repo's own tag namespace stays untouched (#718).
 */

import { appendFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';

import { execInherit } from '../utils/exec-inherit.js';
import { fixtureConfigToml } from './fixture-config-toml.js';
import { decideUploadedExpectations } from './uploaded-expectations.js';

// Mirrors fixture-materialize's throwaway repo: `ensureTag` tags a commit, so
// the tree needs a HEAD, and signing is off because the runner holds no key.
const GIT_STEPS: readonly (readonly string[])[] = [
  ['init', '-q', '-b', 'main'],
  ['config', 'user.email', 'e2e@putitoutthere.dev'],
  ['config', 'user.name', 'piot e2e'],
  ['config', 'commit.gpgsign', 'false'],
  ['config', 'tag.gpgsign', 'false'],
  ['add', '.'],
  ['commit', '-q', '-m', 'e2e: pypi-tag fixture'],
];

export async function runPypiTagPrepare(): Promise<number> {
  const tree = process.env.TAG_TREE;
  if (tree === undefined || tree === '') {
    process.stdout.write('::error::pypi-tag-verify: TAG_TREE must be set.\n');
    return 1;
  }
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput === undefined || githubOutput === '') {
    process.stdout.write('::error::pypi-tag-verify: GITHUB_OUTPUT must be set.\n');
    return 1;
  }

  const filenames = (await readdir('dist', { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const decided = decideUploadedExpectations(filenames);
  if ('errorLine' in decided) {
    process.stdout.write(`::error::${decided.errorLine}\n`);
    return 1;
  }

  await rm(tree, { recursive: true, force: true });
  await mkdir(tree, { recursive: true });
  await writeFile(`${tree}/putitoutthere.toml`, fixtureConfigToml(decided.expectations));
  for (const args of GIT_STEPS) {
    await execInherit('git', [...args], { cwd: tree });
  }

  for (const { name, version, tag } of decided.expectations) {
    process.stdout.write(`  expecting ${name}@${version} -> ${tag}\n`);
  }
  await appendFile(githubOutput, `expect=${JSON.stringify(decided.expectations)}\n`);
  return 0;
}

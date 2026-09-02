/**
 * `putitoutthere resolve` (#683): willfire's callback map for the e2e
 * plan job (epic thekevinscott/willfire#152). One JSON line on stdout,
 * keyed per the frozen thekevinscott/willfire#153 format, one entry per
 * fixture directory. All matrix computation is delegated to the
 * `fixture-matrix` core in `@putitoutthere/ci` (#670) — no parallel
 * plan logic here, per design-commitments.md non-goal 7. The core is a
 * private workspace package, so the map is only answerable from a
 * checkout of this repo — which is also the only checkout defining the
 * workflow the key names.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import pkg from '../../package.json' with { type: 'json' };
import { execCapture } from '../utils/exec-capture.js';
import { pathExists } from '../utils/path-exists.js';
import { buildCallbackMap } from './build-callback-map.js';
import { parseFixtureDocument } from './parse-fixture-document.js';
import { repoSlugFromRepositoryUrl } from './repo-slug.js';
import type { FixtureDocument } from './parse-fixture-document.js';

export async function runResolve(opts: { cwd: string }): Promise<number> {
  // Function-scoped so the mutation gate can switch them per test run;
  // module-level initializers evaluate before a mutant activates and
  // false-survive.
  const WORKFLOW_PATH = '.github/workflows/e2e-fixture-job.yml';
  const JOB_ID = 'plan';
  const FIXTURES_REL = 'packages/engine/tests/fixtures';
  const CI_CORE_BIN = ['node_modules', '@putitoutthere', 'ci', 'dist', 'cli-bin.js'];
  if (!(await pathExists(join(opts.cwd, ...WORKFLOW_PATH.split('/'))))) {
    process.stdout.write('{}\n');
    return 0;
  }
  const fixturesRoot = join(opts.cwd, ...FIXTURES_REL.split('/'));
  if (!(await pathExists(fixturesRoot))) {
    throw new Error(`resolve: fixtures root missing at ${FIXTURES_REL}`);
  }
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  const fixtures = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const coreBin = join(opts.cwd, ...CI_CORE_BIN);
  const documents: FixtureDocument[] = [];
  for (const fixture of fixtures) {
    const { stdout } = await execCapture(
      process.execPath,
      [coreBin, 'fixture-matrix', fixture],
      { cwd: opts.cwd },
    );
    documents.push(parseFixtureDocument(stdout, fixture));
  }
  const key = `${repoSlugFromRepositoryUrl(pkg.repository.url)}/${WORKFLOW_PATH}:${JOB_ID}`;
  process.stdout.write(JSON.stringify(buildCallbackMap(key, documents)) + '\n');
  return 0;
}

/**
 * Materializes a fixture into a throwaway temp dir for the fixture-matrix
 * gate (#670): copy the fixture tree, stamp a fixed placeholder version,
 * and git-init + commit so `plan()` sees a real repo with a HEAD commit and
 * no tags (the first-release path). Mirrors `fixture-materialize`'s `plan`
 * phase minus the `-placeholder` → run-scoped rewrite: fixture-matrix
 * reports the row a first-publish fixture ships with literally, not a
 * run-scoped unique name (see the integration test's
 * `piot-fixture-zzz-poly-rust-placeholder` assertion).
 */

import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applySubstitutions } from '../fixture-materialize/apply-substitutions.js';
import { execInherit } from '../utils/exec-inherit.js';

export async function materializeFixtureForMatrix(fixturesRoot: string, fixture: string): Promise<string> {
  // Mirrors fixture-materialize's MANIFEST_NAMES / GIT_STEPS (#447): the same
  // manifest basenames carry `__VERSION__`, and the same throwaway-repo shape
  // gives `plan()` a HEAD commit with no tags. Function-scoped so the mutation
  // gate can switch them per test run; module-level initializers evaluate
  // before a mutant activates and false-survive.
  const MANIFEST_NAMES = ['putitoutthere.toml', 'package.json', 'Cargo.toml', 'pyproject.toml'];
  const FIXTURE_MATRIX_VERSION = '0.0.0';
  const GIT_STEPS: readonly (readonly string[])[] = [
    ['init', '-q', '-b', 'main'],
    ['config', 'user.email', 'e2e@putitoutthere.dev'],
    ['config', 'user.name', 'piot e2e'],
    ['config', 'commit.gpgsign', 'false'],
    ['config', 'tag.gpgsign', 'false'],
    ['add', '.'],
    ['commit', '-q', '-m', 'e2e: initial fixture'],
  ];

  const dir = await mkdtemp(join(tmpdir(), 'piot-fixture-matrix-'));
  await cp(join(fixturesRoot, fixture), dir, { recursive: true });

  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !MANIFEST_NAMES.includes(entry.name)) {
      continue;
    }
    const filePath = join(entry.parentPath, entry.name);
    const content = await readFile(filePath, 'utf8');
    await writeFile(filePath, applySubstitutions(content, [{ from: '__VERSION__', to: FIXTURE_MATRIX_VERSION }]));
  }

  for (const args of GIT_STEPS) {
    await execInherit('git', [...args], { cwd: dir });
  }

  return dir;
}

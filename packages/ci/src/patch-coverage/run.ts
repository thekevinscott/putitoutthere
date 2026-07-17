/**
 * Composition root for the patch-coverage gate (#468). Reads BASE_SHA /
 * HEAD_SHA from the env, checks both SHAs are reachable, runs the rename-aware
 * `git diff` the decision needs, reads the engine's coverage-final.json (only
 * when there are added lines to check), then feeds the settled state to
 * `decidePatchCoverage`, writes its stdout / stderr lines, and returns the exit
 * code. The only I/O lives here; every decision is a pure module under this
 * directory.
 *
 * Exit codes mirror the extracted `.mjs`: 2 for the I/O guards (missing env,
 * unreachable SHA, unreadable coverage file), 1 for violations, 0 for a pass.
 */

import { readFile } from 'node:fs/promises';

import { execCapture } from '../utils/exec-capture.js';
import { coveredLines } from './covered-lines.js';
import { decidePatchCoverage } from './decide.js';
import { parseAddedLines } from './parse-added-lines.js';
import type { FileCoverage } from './patch-coverage-types.js';

// Repo-relative path to the v8 reporter's istanbul-format output. Resolved
// against the cwd below (forward-slash concatenation, matching the `.mjs`'s
// `resolve(...)` for this simple relative path) so the coverage JSON's
// absolute keys line up.
const COVERAGE_PATH = 'packages/engine/coverage/coverage-final.json';

export async function runPatchCoverage(): Promise<number> {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (base === undefined || base === '' || head === undefined || head === '') {
    process.stderr.write('::error::patch-coverage: BASE_SHA and HEAD_SHA must be set\n');
    return 2;
  }

  // Defensive: actions/checkout@v6 with fetch-depth: 0 gives a full clone, so
  // both SHAs should be present. A missing object is a fatal setup error.
  try {
    await execCapture('git', ['cat-file', '-e', base]);
    await execCapture('git', ['cat-file', '-e', head]);
  } catch {
    process.stderr.write(`::error::patch-coverage: ${base} or ${head} not reachable in this clone\n`);
    return 2;
  }

  const diffOut = (await execCapture('git', ['diff', '--unified=0', '--no-prefix', '-M', `${base}..${head}`], {
    maxBuffer: 64 * 1024 * 1024,
  })).stdout;
  const addedByFile = parseAddedLines(diffOut);

  const cwd = process.cwd();
  const covPath = `${cwd}/${COVERAGE_PATH}`;
  // Empty when there are no additions (the file is never read then); decide
  // only consults `coverageFor` when there are additions, at which point this
  // holds the parsed coverage — so the lookup never sees a null map.
  let cov: Record<string, FileCoverage> = {};
  if (addedByFile.length > 0) {
    try {
      cov = JSON.parse(await readFile(covPath, 'utf8')) as Record<string, FileCoverage>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`::error::patch-coverage: cannot read ${covPath}: ${message}\n`);
      return 2;
    }
  }

  const result = decidePatchCoverage({
    addedByFile,
    coverageFor: (file) => coveredLines(cov[`${cwd}/${file}`]),
  });
  for (const line of result.out) {
    process.stdout.write(`${line}\n`);
  }
  for (const line of result.err) {
    process.stderr.write(`${line}\n`);
  }
  return result.exitCode;
}

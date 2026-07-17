/**
 * Composition root for the changelog-check gate (#452). Reads BASE_SHA /
 * HEAD_SHA from the env, runs the `git log` / `git diff` invocations the
 * decision needs, feeds them to `decideChangelogCheck`, writes the lines,
 * and returns the exit code. The only I/O lives here; the decision is
 * `decide.ts`'s.
 */

import { execCapture } from '../utils/exec-capture.js';
import { decideChangelogCheck } from './decide.js';

// Public-surface globset — broad by design (see AGENTS.md "Changelog and
// migration policy"); `:!` entries are git pathspec exclusions. Kept in
// sync with AGENTS.md and the workflow it replaces.
const SURFACE_PATHSPECS = [
  'action.yml',
  'packages/engine/src/**/*.ts',
  ':!packages/engine/src/**/*.test.ts',
  'docs/api/**',
  'docs/guide/**',
  ':!docs/guide/migrations.md',
];

export async function runChangelogCheck(): Promise<number> {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (base === undefined || base === '' || head === undefined || head === '') {
    process.stdout.write('::error::changelog-check: BASE_SHA and HEAD_SHA must be set.\n');
    return 1;
  }

  const lines = (out: string): string[] => out.split('\n').filter((l) => l !== '');
  const commitLog = (await execCapture('git', ['log', '--format=%B', `${base}..${head}`])).stdout;
  const surfaceFiles = lines(
    (await execCapture('git', ['--glob-pathspecs', 'diff', '--name-only', base, head, '--', ...SURFACE_PATHSPECS]))
      .stdout,
  );
  const changedFiles = lines((await execCapture('git', ['diff', '--name-only', base, head])).stdout);

  const result = decideChangelogCheck({ commitLog, surfaceFiles, changedFiles });
  for (const line of result.lines) {process.stdout.write(`${line}\n`);}
  return result.exitCode;
}

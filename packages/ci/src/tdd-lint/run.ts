/**
 * Composition root for the tdd-lint gate (#452). Reads BASE_SHA / HEAD_SHA
 * from the env, runs the `git log` / `git diff` invocations the decision
 * needs, feeds them to `decideTddLint`, writes the lines, and returns the
 * exit code. The only I/O lives here; the decision is `decide.ts`'s.
 */

import { execFileSync } from 'node:child_process';

import { decideTddLint } from './decide.js';

export function runTddLint(): number {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (base === undefined || base === '' || head === undefined || head === '') {
    process.stdout.write('::error::tdd-lint: BASE_SHA and HEAD_SHA must be set.\n');
    return 1;
  }

  const commitLog = execFileSync('git', ['log', '--format=%B', `${base}..${head}`], { encoding: 'utf8' });
  const changedFiles = execFileSync('git', ['diff', '--name-only', base, head, '--', 'packages/engine/src/'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((l) => l !== '');

  const result = decideTddLint({ commitLog, changedFiles });
  for (const line of result.lines) {process.stdout.write(`${line}\n`);}
  return result.exitCode;
}

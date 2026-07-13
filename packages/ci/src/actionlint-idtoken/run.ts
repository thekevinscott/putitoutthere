/**
 * Composition root for the actionlint id-token gate (#452). Reads the three
 * PR-time-path workflow files, feeds their contents to
 * `decideActionlintIdToken`, writes the lines, and returns the exit code. The
 * only I/O lives here; the decision is `decide.ts`'s.
 */

import { readFileSync } from 'node:fs';

import { decideActionlintIdToken } from './decide.js';

// The files that constitute the PR-time path (issues #272, #317). These must
// never grow `id-token: write` — that is what makes it impossible for a
// PR-time invocation to mint an OIDC token capable of publishing. Do not
// generalise this list; a new OIDC-bearing file belongs on the publish path.
const PR_TIME_PATH_FILES = [
  '.github/workflows/build.yml',
  '.github/workflows/_matrix.yml',
  '.github/workflows/check.yml',
];

export function runActionlintIdToken(): number {
  const files = PR_TIME_PATH_FILES.map((path) => ({ path, content: readFileSync(path, 'utf8') }));
  const result = decideActionlintIdToken({ files });
  for (const line of result.lines) {process.stdout.write(`${line}\n`);}
  return result.exitCode;
}

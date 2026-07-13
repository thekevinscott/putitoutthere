/**
 * Decision core for the Verdaccio-auth harness (#453, epic #442). I/O-free:
 * given the plan matrix, the token the Verdaccio user-create returned, and the
 * raw response body, decide whether the token is usable, which per-package
 * `.npmrc` files to write (and their contents), and the exact log lines.
 * Extracted from the "Configure Verdaccio auth (first-publish)" bash in
 * `e2e-fixture-job.yml`; the decisions and `::error::`/`::add-mask::`/`Wrote`
 * text match it exactly (pinned in `decide.test.ts`). The ping poll and the
 * user-create PUT are the composition root's I/O (`run.ts`).
 */

import { parseNpmPaths } from './npm-paths.js';

export interface VerdaccioAuthInput {
  /** The plan matrix JSON (`needs.plan.outputs.matrix`). */
  matrix: string;
  /** `jq -r '.token'` of the user-create response ('null' when absent). */
  token: string;
  /** The raw user-create response body, echoed in the failure message. */
  response: string;
}

export interface NpmrcWrite {
  path: string;
  content: string;
}

export interface VerdaccioAuthResult {
  exitCode: number;
  lines: readonly string[];
  files: readonly NpmrcWrite[];
}

function npmrc(token: string): string {
  return `registry=http://localhost:4873/\n//localhost:4873/:_authToken=${token}\nalways-auth=true\n`;
}

export function decideVerdaccioAuth(input: VerdaccioAuthInput): VerdaccioAuthResult {
  // Mirrors bash `[ -z "$TOKEN" ] || [ "$TOKEN" = 'null' ]`.
  if (input.token === '' || input.token === 'null') {
    return {
      exitCode: 1,
      lines: [`::error::Verdaccio user-create did not return a token. Response: ${input.response}`],
      files: [],
    };
  }

  const lines: string[] = [`::add-mask::${input.token}`];
  const files: NpmrcWrite[] = [];
  for (const path of parseNpmPaths(input.matrix)) {
    files.push({ path: `fixture-tree/${path}/.npmrc`, content: npmrc(input.token) });
    lines.push(`Wrote fixture-tree/${path}/.npmrc`);
  }

  return { exitCode: 0, lines, files };
}

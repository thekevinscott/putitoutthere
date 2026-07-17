/**
 * Composition root for `testpypi-verify assert` — the "Assert TestPyPI fixture
 * artifacts exist" step. Reads the file basenames under `dist/` (the only
 * I/O), hands them to `decideAssertArtifacts`, prints the listing + any
 * missing-artifact error, and returns the exit code. The decision is
 * `assert-artifacts.ts`'s.
 */

import { readdir } from 'node:fs/promises';

import { decideAssertArtifacts } from './assert-artifacts.js';

const DIST_DIR = 'dist';

export async function runTestpypiAssert(): Promise<number> {
  const filenames = (await readdir(DIST_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const decision = decideAssertArtifacts(filenames);
  for (const line of decision.lines) {
    process.stdout.write(`${line}\n`);
  }
  return decision.exitCode;
}

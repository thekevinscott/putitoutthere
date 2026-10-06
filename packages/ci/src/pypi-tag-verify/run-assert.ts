/**
 * Composition root for `pypi-tag-verify assert` — the step that reads the e2e
 * tag job's tags back out of the throwaway tree's `origin`, so a tag that was
 * cut but never pushed (#717) fails it. The only I/O lives here; the
 * decision is `assert-expected-tags.ts`'s.
 *
 * Re-derives the expectation from `dist/` rather than taking a value passed
 * through from `prepare`, so the two steps cannot disagree about what the
 * upload shipped.
 */

import { readdir } from 'node:fs/promises';

import { execCapture } from '../utils/exec-capture.js';
import { decideAssertExpectedTags } from './assert-expected-tags.js';
import { decideUploadedExpectations } from './uploaded-expectations.js';

export async function runPypiTagAssert(): Promise<number> {
  const tree = process.env.TAG_TREE;
  if (tree === undefined || tree === '') {
    process.stdout.write('::error::pypi-tag-verify: TAG_TREE must be set.\n');
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

  const { stdout } = await execCapture('git', ['ls-remote', '--tags', '--refs', 'origin'], { cwd: tree });
  const tags = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.slice(line.indexOf('refs/tags/') + 'refs/tags/'.length));
  const decision = decideAssertExpectedTags(decided.expectations, tags);
  for (const line of decision.lines) {
    process.stdout.write(`${line}\n`);
  }
  return decision.exitCode;
}

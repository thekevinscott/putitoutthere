/**
 * Write a publish run's release facts to `$GITHUB_OUTPUT` (#461, #623).
 *
 * Four keys, in two pairs:
 *
 *  - `released` / `released_packages` (#461) — what this run actually put
 *    on a registry. A post-release job (changelog assembly, docs stamping,
 *    announcements) gates on these.
 *  - `delegated` / `delegated_packages` (#623) — PyPI packages whose
 *    upload the engine handed to a caller-side job. They have NOT shipped
 *    and are deliberately absent from the `released` pair: no tag has been
 *    cut for them, and the upload has not happened. The caller's
 *    `pypi-publish` job gates on `delegated`, which is why this is written
 *    on the failure path too — "PyPI's own path succeeded" has to be
 *    answerable after an unrelated registry failed the run.
 *
 * A no-op when `$GITHUB_OUTPUT` is unset (local runs), so callers don't
 * have to branch on being inside Actions.
 */

import { appendFile } from 'node:fs/promises';

import type { PublishOutput } from './publish.js';

export async function emitReleaseOutputs(
  published: PublishOutput['published'],
  githubOutput: string | undefined,
): Promise<void> {
  if (githubOutput === undefined || githubOutput === '') {return;}
  const facts = (status: string): string =>
    JSON.stringify(
      published
        .filter((p) => p.result.status === status)
        .map((p) => ({ name: p.package, version: p.version, tag: p.tag })),
    );
  const shipped = facts('published');
  const delegated = facts('delegated');
  await appendFile(
    githubOutput,
    `released=${shipped !== '[]'}\n` +
      `released_packages=${shipped}\n` +
      `delegated=${delegated !== '[]'}\n` +
      `delegated_packages=${delegated}\n`,
    'utf8',
  );
}

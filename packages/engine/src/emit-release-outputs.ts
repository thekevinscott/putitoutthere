/**
 * Write a publish run's release facts to `$GITHUB_OUTPUT` (#461, #623):
 * `released`/`released_packages` for what shipped, plus
 * `delegated`/`delegated_packages` for PyPI uploads handed to a caller-side
 * job — deliberately not `released`, and written on the failure path too.
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

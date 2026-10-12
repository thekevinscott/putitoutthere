/**
 * PyPI handler (#17, #623; plan §6.4, §12.2, §12.3, §13.1, §14.5, §16.1). TP
 * matching filters on `repository_owner`/`repository_name` before
 * `job_workflow_ref`, so a cross-repo reusable workflow's token never matches
 * (pypi/warehouse#11096): `publish` uploads nothing, returns `{ status:
 * 'delegated' }`, and the caller's `pypi-publish` job uploads and tags.
 */

import type { Ctx, Handler, PublishResult } from '../types.js';
import { pypiIsPublished } from './pypi-is-published.js';
import { pypiLatestVersion } from './pypi-latest-version.js';
import { pypiNameFor } from './pypi-name-for.js';
import { pypiTrustPosture } from './pypi-trust-posture.js';
import { pypiWriteVersion } from './pypi-write-version.js';

async function publishImpl(
  pkg: { name: string; path: string; pypi?: string },
  version: string,
  ctx: Ctx,
): Promise<PublishResult> {
  if (await pypiIsPublished(pkg, version, ctx)) {
    return { status: 'already-published' };
  }

  // No upload from here. The engine's role for PyPI is plan + build +
  // version-rewrite — the actual `pypa/gh-action-pypi-publish` call
  // lives in the caller's `pypi-publish` job, where the OIDC claims
  // align with their TP registration. `delegated` is what tells
  // `publish.ts` to hold the tag (#623): nothing is on PyPI yet, and a
  // tag cut here would outlive a run that never reached the upload.
  ctx.log.info(
    [
      `pypi: ${pkg.name}@${version} delegated to caller-side upload step.`,
      '  The upload runs in your `pypi-publish` job via `pypa/gh-action-pypi-publish`;',
      '  the git tag is cut there too, after PyPI confirms the version is live.',
      '  See README → "Publishing to PyPI" for the recipe.',
    ].join('\n'),
  );

  return {
    status: 'delegated',
    url: `https://pypi.org/project/${pypiNameFor(pkg)}/${version}/`,
  };
}

export const pypi: Handler = {
  kind: 'pypi',
  isPublished: pypiIsPublished,
  latestVersion: pypiLatestVersion,
  trustPosture: pypiTrustPosture,
  writeVersion: pypiWriteVersion,
  publish: publishImpl,
};

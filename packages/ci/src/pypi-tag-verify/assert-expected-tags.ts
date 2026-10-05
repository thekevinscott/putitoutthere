/**
 * Decision core for `pypi-tag-verify assert`: did reconcile cut a tag for
 * every version the upload shipped. I/O-free.
 *
 * `reconcile` exits 0 when it decides there is nothing to do, which is #694's
 * whole failure mode — the version is on PyPI, the project pointer has not
 * propagated, the tag is silently skipped. Reading the tags back is what turns
 * that decision into something the e2e lane can fail on.
 */

import type { UploadedExpectation } from './uploaded-expectations.js';

export interface AssertExpectedTagsDecision {
  lines: string[];
  exitCode: number;
}

export function decideAssertExpectedTags(
  expectations: readonly UploadedExpectation[],
  tags: readonly string[],
): AssertExpectedTagsDecision {
  const missing = expectations.filter((e) => !tags.includes(e.tag));
  const lines = expectations.map((e) =>
    tags.includes(e.tag)
      ? `  tagged: ${e.tag}`
      : `::error::pypi-tag-verify: ${e.name}@${e.version} is on PyPI but reconcile cut no ${e.tag} tag (#694)`,
  );
  return { lines, exitCode: missing.length > 0 ? 1 : 0 };
}

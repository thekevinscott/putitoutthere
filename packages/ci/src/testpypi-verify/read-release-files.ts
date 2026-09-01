/**
 * One read of TestPyPI's release-metadata document. Fetches the version-pinned
 * `/pypi/{package}/{version}/json` URL and hands the body to the parser,
 * reporting a 404 distinctly from every other way the read can fail — that
 * distinction is what lets the caller say "this version is not on TestPyPI"
 * instead of blaming index lag (#668).
 *
 * Reads through `fetch` rather than the `curl` exec seam because the status
 * code is the signal: `curl -f` collapses 404 and a transport error into the
 * same non-zero exit.
 */

import { errorMessage } from './error-message.js';
import { parseReleaseFiles } from './parse-release-files.js';
import type { ReleaseFiles } from './release-file-types.js';

export interface ReadReleaseFailure {
  notFound: boolean;
  reason: string;
}

export type ReadReleaseResult = { files: ReleaseFiles } | { failure: ReadReleaseFailure };

export async function readReleaseFiles(url: string): Promise<ReadReleaseResult> {
  try {
    const response = await fetch(url);
    if (response.status === 404) {
      return { failure: { notFound: true, reason: 'HTTP 404' } };
    }
    if (!response.ok) {
      return { failure: { notFound: false, reason: `HTTP ${response.status}` } };
    }
    const files = parseReleaseFiles(await response.text());
    if (files === null) {
      return { failure: { notFound: false, reason: 'unreadable release metadata' } };
    }
    return { files };
  } catch (error) {
    return { failure: { notFound: false, reason: errorMessage(error) } };
  }
}

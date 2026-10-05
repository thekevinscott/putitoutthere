/**
 * Decision core for `pypi-tag-verify`: what the PyPI upload shipped, read off
 * the artifacts it was handed. I/O-free. The shape matches `release.yml`'s
 * `delegated_packages`, so the e2e tag job forwards it through the same
 * `expect:` input a consumer does.
 *
 * `pypi-publish` discards the #294 first-publish artifacts before uploading —
 * real PyPI has no Trusted Publisher record for their uniquified names — so
 * they are filtered here too: `reconcile --expect` hard-fails on a version
 * that is not on the registry. Everything else must agree on exactly one
 * version per project, because disagreement means this derivation is wrong,
 * not the upload.
 */

import { parseDistribution } from './parse-distribution.js';

export interface UploadedExpectation {
  name: string;
  version: string;
  tag: string;
}

export type UploadedExpectationsResult =
  | { expectations: UploadedExpectation[] }
  | { errorLine: string };

export function decideUploadedExpectations(
  filenames: readonly string[],
): UploadedExpectationsResult {
  const byProject = new Map<string, string>();
  for (const filename of filenames) {
    // The token #294's discard step matches, in both the `-` and `_`
    // spellings wheel/sdist naming produces.
    if (filename.includes('placeholder')) {
      continue;
    }
    const parsed = parseDistribution(filename);
    if (parsed === null) {
      return { errorLine: `pypi-tag-verify: dist/${filename} is not a wheel or sdist filename` };
    }
    const known = byProject.get(parsed.project);
    if (known !== undefined && known !== parsed.version) {
      return {
        errorLine: `pypi-tag-verify: ${parsed.project} artifacts carry both ${known} and ${parsed.version} — exactly one version per project is expected`,
      };
    }
    byProject.set(parsed.project, parsed.version);
  }
  if (byProject.size === 0) {
    // The job only runs when `have_pypi` reported an upload, so nothing
    // publishable here means the two disagree — and an empty `--expect` is a
    // silent no-op downstream, not a failure.
    return {
      errorLine:
        'pypi-tag-verify: dist/ holds no uploadable wheel or sdist, but have_pypi reported a PyPI upload',
    };
  }
  return {
    expectations: [...byProject]
      .map(([name, version]) => ({ name, version, tag: `${name}-v${version}` }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

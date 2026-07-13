/**
 * Find the first anchor href whose filename ends with the expected sdist
 * suffix (`-<version>.tar.gz`), reproducing the bash loop over the parsed
 * hrefs that downloaded the first match and otherwise raised
 * `no sdist ending {expected_suffix}`. Returns the matching href, or `null`
 * when none matches. Pure.
 */

import { sdistFilenameFromHref } from './sdist-filename.js';

export function findSdistHref(hrefs: readonly string[], expectedSuffix: string): string | null {
  for (const href of hrefs) {
    if (sdistFilenameFromHref(href).endsWith(expectedSuffix)) {
      return href;
    }
  }
  return null;
}

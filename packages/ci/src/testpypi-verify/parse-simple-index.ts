/**
 * Parse a PEP 503 "simple index" HTML page into the list of anchor hrefs,
 * reproducing the bash `SimpleLinks(HTMLParser)` that collected every
 * `<a href="...">` whose href was truthy. The page is split on `<`, so each
 * piece holds at most one tag (its text up to the first `>`); anchor start
 * tags with a non-empty href are kept, in document order. Pure.
 */

import { extractHref } from './extract-href.js';
import { isAnchorStart } from './is-anchor-start.js';

export function parseSimpleIndexHrefs(html: string): string[] {
  const hrefs: string[] = [];
  for (const piece of html.split('<')) {
    const gt = piece.indexOf('>');
    if (gt === -1) {
      continue;
    }
    const tag = piece.slice(0, gt);
    if (!isAnchorStart(tag)) {
      continue;
    }
    const href = extractHref(tag);
    if (href !== null && href.length > 0) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

/**
 * Extract the `href` attribute value from the text between `<` and `>` of an
 * anchor start tag, reproducing the bash `dict(attrs).get("href")` over the
 * shape a PEP 503 simple index emits: `href="URL"` (or single-quoted). The
 * match is case-insensitive, requires a whitespace boundary before the name
 * (so `data-href` and a leading element-name `href` are skipped), and reads
 * the quoted value. Warehouse never emits whitespace around `=`, so `href=`
 * is matched as a unit. Returns the raw value (possibly empty), or `null`
 * when there is no href. Pure.
 */

import { isHtmlSpace } from './is-html-space.js';

const HREF_EQUALS = 'href=';

export function extractHref(tag: string): string | null {
  const lower = tag.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(HREF_EQUALS, from);
    if (at === -1) {
      return null;
    }
    from = at + HREF_EQUALS.length;
    if (!isHtmlSpace(tag.charAt(at - 1))) {
      continue;
    }
    const quote = tag.charAt(at + HREF_EQUALS.length);
    if (quote !== '"' && quote !== "'") {
      continue;
    }
    const valueStart = at + HREF_EQUALS.length + 1;
    const close = tag.indexOf(quote, valueStart);
    if (close === -1) {
      return null;
    }
    return tag.slice(valueStart, close);
  }
}

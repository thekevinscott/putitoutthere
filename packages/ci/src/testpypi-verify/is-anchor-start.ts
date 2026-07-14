/**
 * Whether the text between `<` and `>` of a tag is an anchor (`<a ...>`) start
 * tag — reproducing the bash `SimpleLinks(HTMLParser)` handler that acts only
 * on `handle_starttag(tag == "a")`. The tag name is the text up to the first
 * whitespace or `/`, compared case-insensitively (`<A>` counts); a close tag
 * (`</a>`, text `/a`) yields an empty name and is rejected. With no delimiter,
 * `Math.min()` is `Infinity` and the whole tag is the name. Pure.
 */

export function isAnchorStart(tag: string): boolean {
  const delimiters = [
    tag.indexOf(' '),
    tag.indexOf('\t'),
    tag.indexOf('\n'),
    tag.indexOf('\r'),
    tag.indexOf('/'),
  ].filter((index) => index !== -1);
  const nameEnd = Math.min(...delimiters);
  return tag.slice(0, nameEnd).toLowerCase() === 'a';
}

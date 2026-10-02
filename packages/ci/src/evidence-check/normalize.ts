/**
 * Normalise a run/job field or citation to a slash-delimited lowercase slug,
 * matching the bash `normalize`. `.replace` regexes rather than `.test()`: the
 * output is asserted exactly, so a quantifier mutation is killable.
 */
export function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '/')
    .replace(/^\/|\/$/g, '');
}

/**
 * Normalise a run/job field or a citation to a slash-delimited, lowercase,
 * alphanumeric slug for substring matching, matching the bash `normalize`:
 * lowercase, collapse each run of non-`[a-z0-9]` characters to a single `/`,
 * then strip a leading/trailing `/`. These are `.replace` regexes (their
 * output is asserted exactly), not `.test()`, so a quantifier mutation alters
 * the slug and is killable.
 */
export function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '/')
    .replace(/^\/|\/$/g, '');
}

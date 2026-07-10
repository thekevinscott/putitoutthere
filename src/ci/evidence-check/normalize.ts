/**
 * Canonicalize a run/job/citation string for fuzzy comparison:
 * lowercase, collapse every run of non-alphanumerics to a single `/`,
 * then strip any leading/trailing `/`. `null`/`undefined` become `''`.
 */
export function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '/')
    .replace(/^\/|\/$/g, '');
}

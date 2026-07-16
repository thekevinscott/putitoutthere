/**
 * Whether a coverage-ignore marker is a `stop`/`end` closer rather than an
 * exclusion opener. A closer ends a previously-justified `v8 ignore start`
 * block and introduces no new exclusion, so — unlike a bare `next`/`start` — it
 * needs no reason of its own. Case-insensitive (matching the escape-hatch
 * detector) and fixed-string, so the mutation gate has no quantifier survivors.
 * Pure.
 */
export function isIgnoreStop(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('ignore stop') || lower.includes('ignore end');
}

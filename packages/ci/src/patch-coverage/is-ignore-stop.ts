/**
 * Whether a coverage-ignore marker is a `stop`/`end` closer rather than an
 * exclusion opener. A closer ends an already-justified `v8 ignore start` block
 * and introduces no new exclusion, so — unlike a bare `next`/`start` — it needs
 * no reason of its own. Fixed-string, so no quantifier mutants survive.
 */
export function isIgnoreStop(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('ignore stop') || lower.includes('ignore end');
}

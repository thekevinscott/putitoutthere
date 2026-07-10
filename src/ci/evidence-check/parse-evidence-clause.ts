import type { EvidenceClause } from './types.js';

/**
 * Parse a trailing `(verified by: ...)` or `(no fixture: ...)` clause
 * off the end of a bullet. The keyword is lowercased and the captured
 * value trimmed. Returns `null` when there is no such trailing clause.
 */
export function parseEvidenceClause(text: string): EvidenceClause | null {
  const match = /\((verified by|no fixture):\s*([^)]+)\)\s*$/i.exec(text);
  if (!match) {
    return null;
  }
  return { kind: match[1]!.toLowerCase(), value: match[2]!.trim() };
}

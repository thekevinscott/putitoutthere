import { parsePackageList } from './parse-package-list.js';
import type { Trailer } from './trailer.js';

const isValidValue = (s: string): s is Trailer['bump'] => new Set(['patch', 'minor', 'major', 'skip']).has(s);

/** Parse a trailer payload: `<value>` or `<value> [pkg, pkg, ...]`. */
export function parseTrailerPayload(payload: string): Trailer | null {
  const bracketIdx = payload.indexOf('[');
  const valueText = (bracketIdx === -1 ? payload : payload.slice(0, bracketIdx)).trim();

  if (!isValidValue(valueText)) {
    return null;
  }

  if (bracketIdx === -1) {
    return { bump: valueText, packages: [] };
  }

  const packages = parsePackageList(payload.slice(bracketIdx));
  if (packages === null) {return null;}
  return { bump: valueText, packages };
}

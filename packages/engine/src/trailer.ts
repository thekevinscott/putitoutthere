/**
 * Release trailer parser (#6; grammar plan.md §10.3, semantics §10.6):
 * `release: patch|minor|major|skip [ "[" name, name "]" ]`. The key match is
 * case-insensitive and only the LAST `release:` line wins. Pure TypeScript —
 * no `git interpret-trailers`, no folded-continuation support.
 */

import type { Bump } from './types.js';

export interface Trailer {
  bump: Bump | 'skip';
  packages: string[];
}

type Value = Bump | 'skip';
const VALID_VALUES = new Set<Value>(['patch', 'minor', 'major', 'skip']);

// `release:` key, case-insensitive. Captures the remainder of the line.
// Anchored with `^\s*` so indented trailers still count (§10 is silent on
// indentation; real commit bodies rarely indent trailers, be lenient).
const TRAILER_LINE = /^\s*release\s*:\s*(.*?)\s*$/i;

// Package names: letters, digits, hyphen, underscore, dot. Matches what
// npm / crates.io / PyPI themselves accept in identifiers.
const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseTrailer(commitBody: string): Trailer | null {
  const lines = commitBody.split(/\r?\n/);
  // Scan in reverse; first hit = last occurrence.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const match = TRAILER_LINE.exec(line);
    if (!match) {continue;}
    const payload = match[1];
    if (payload === undefined || payload === '') {
      // `release:` with no value — malformed.
      return null;
    }
    return parsePayload(payload);
  }
  return null;
}

function parsePayload(payload: string): Trailer | null {
  // The payload is `<value>` or `<value> [pkg, pkg, ...]`.
  const bracketIdx = payload.indexOf('[');
  const valueText = (bracketIdx === -1 ? payload : payload.slice(0, bracketIdx)).trim();

  if (!isValidValue(valueText)) {
    return null;
  }

  if (bracketIdx === -1) {
    return { bump: valueText, packages: [] };
  }

  const listText = payload.slice(bracketIdx);
  const packages = parsePackageList(listText);
  if (packages === null) {return null;}
  return { bump: valueText, packages };
}

function isValidValue(s: string): s is Value {
  return VALID_VALUES.has(s as Value);
}

export function parsePackageList(s: string): string[] | null {
  // Must open with `[` and close with `]`; nothing after the close.
  if (!s.startsWith('[')) {return null;}
  const closeIdx = s.indexOf(']');
  if (closeIdx === -1) {return null;}
  const tail = s.slice(closeIdx + 1).trim();
  if (tail.length > 0) {return null;} // stray text after list
  const inner = s.slice(1, closeIdx).trim();
  if (inner === '') {return [];} // `release: minor []` → no packages
  const parts = inner.split(',').map((p) => p.trim());
  for (const name of parts) {
    if (name === '' || !PACKAGE_NAME.test(name)) {return null;}
  }
  return parts;
}

/**
 * Decision core for the version assertion, reproducing the bash's stderr
 * mismatch line and its `ok: …` success line. `label` is `METADATA` for wheels
 * and `PKG-INFO` for sdists; `actual` is the parsed version, or `null` when no
 * `Version:` line was found. Pure.
 */

import { pyRepr } from './py-repr.js';

export interface VersionMatchInput {
  name: string;
  label: string;
  actual: string | null;
  expected: string;
}

export type VersionMatchResult = { okLine: string } | { errorLine: string };

export function versionMatch(input: VersionMatchInput): VersionMatchResult {
  if (input.actual !== input.expected) {
    return {
      errorLine: `${input.name} ${input.label} Version=${pyRepr(input.actual)}, expected ${pyRepr(input.expected)}`,
    };
  }
  return { okLine: `ok: ${input.name} ${input.label} Version=${input.actual}` };
}

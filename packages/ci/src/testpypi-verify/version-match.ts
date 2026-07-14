/**
 * Decision core for the version assertion, reproducing the bash's
 * `if actual != version: print(f"{name} {LABEL} Version={actual!r}, expected
 * {version!r}", file=sys.stderr); sys.exit(1)` followed by
 * `print(f"ok: {name} {LABEL} Version={actual}")`. `label` is `METADATA` for
 * wheels and `PKG-INFO` for sdists; `actual` is the parsed version or `null`
 * when no `Version:` line was found. Pure.
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

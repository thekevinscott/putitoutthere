/**
 * Version bumper (#8; plan.md §14.3 bump semantics, §14.4 first version).
 * Strict semver, no pre-release suffixes in v0 (§26.2). Pre-1.0 does *not* use
 * the "breaking minor bumps" convention: 0.1.5 + minor is 0.2.0, not 1.0.0.
 * Also exports `USER_AGENT`, sourced from `package.json` at build time (#147).
 */

import pkg from '../package.json' with { type: 'json' };
import { formatSemver } from './format-semver.js';
import { parseSemver } from './parse-semver.js';
import type { Bump } from './types.js';

export { firstVersion } from './first-version.js';
export { formatSemver } from './format-semver.js';
export { parseSemver } from './parse-semver.js';
export type { Semver } from './version-types.js';

/** CLI version, read from package.json at build time. */
export const VERSION: string = pkg.version;

/** Canonical User-Agent for all outbound HTTP calls. */
export const USER_AGENT: string = `putitoutthere/${VERSION}`;

export function bump(lastVersion: string, bumpType: Bump): string {
  const v = parseSemver(lastVersion);
  switch (bumpType) {
    case 'patch':
      return formatSemver({ ...v, patch: v.patch + 1 });
    case 'minor':
      return formatSemver({ major: v.major, minor: v.minor + 1, patch: 0 });
    case 'major':
      return formatSemver({ major: v.major + 1, minor: 0, patch: 0 });
    default: {
      // Runtime guard for callers that bypass the type system.
      throw new Error(`unknown bump type: ${String(bumpType)}`);
    }
  }
}


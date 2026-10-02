/**
 * Version bumper (#8; plan.md §14.3 bump semantics, §14.4 first version).
 * Strict semver, no pre-release suffixes in v0 (§26.2). Pre-1.0 does *not* use
 * the "breaking minor bumps" convention: 0.1.5 + minor is 0.2.0, not 1.0.0.
 * Also exports `USER_AGENT`, sourced from `package.json` at build time (#147).
 */

import pkg from '../package.json' with { type: 'json' };
import type { Bump } from './types.js';

/** CLI version, read from package.json at build time. */
export const VERSION: string = pkg.version;

/** Canonical User-Agent for all outbound HTTP calls. */
export const USER_AGENT: string = `putitoutthere/${VERSION}`;

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

// Strict: no leading v, no pre-release, no build metadata, no leading zeros.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseSemver(s: string): Semver {
  const m = SEMVER.exec(s);
  if (!m) {
    throw new Error(`invalid semver: ${s}`);
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

export function formatSemver(v: Semver): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

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

/**
 * First-release version. Uses `package.first_version` when set, else
 * the repo-wide default of `0.1.0`. Either way the value is validated
 * against strict semver so typos fail loud before we tag.
 */
export function firstVersion(pkg: { first_version?: string }): string {
  const candidate = pkg.first_version ?? '0.1.0';
  parseSemver(candidate); // throws on invalid
  return candidate;
}

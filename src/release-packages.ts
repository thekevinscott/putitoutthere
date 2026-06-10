/**
 * `release_packages` manual-release spec parser.
 *
 * The spec is the value of the reusable workflow's `release_packages`
 * input. It lets a consumer trigger a release of explicitly named
 * packages without any new code — the motivating case being a
 * re-release after a putitoutthere bug fix, where the consumer's repo
 * has no new commits but the packages still need to ship again.
 *
 * Grammar:
 *   spec       = entry *( "," entry )
 *   entry      = package-name [ "@" version-spec ]
 *   version-spec = "patch" | "minor" | "major" | semver
 *
 * A bare package name defaults to a `patch` bump. `semver` is strict
 * `X.Y.Z` (see `version.ts`). Whitespace around entries and the comma
 * separator is tolerated.
 */

import { parseSemver } from './version.js';
import type { Bump } from './types.js';

export interface ReleasePackagesEntry {
  name: string;
  /** Set when the entry gave a bump keyword (or a bare name → patch). */
  bump?: Bump;
  /** Set when the entry gave an explicit semver. */
  version?: string;
}

// Same identifier shape the trailer parser and config loader accept.
const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BUMPS = new Set<Bump>(['patch', 'minor', 'major']);

/**
 * Parse a `release_packages` spec into a name→entry map. Returns `null`
 * when the spec is absent or empty (the caller falls back to normal
 * change-detected planning). Throws on any malformed entry.
 */
export function parseReleasePackages(
  spec: string | undefined,
): Map<string, ReleasePackagesEntry> | null {
  if (spec === undefined) {return null;}
  const trimmed = spec.trim();
  if (trimmed === '') {return null;}

  const out = new Map<string, ReleasePackagesEntry>();
  for (const raw of trimmed.split(',')) {
    const part = raw.trim();
    if (part === '') {
      throw new Error(
        `release-packages: empty entry in "${spec}" — remove the stray comma`,
      );
    }
    const at = part.indexOf('@');
    const name = at === -1 ? part : part.slice(0, at);
    const versionSpec = at === -1 ? undefined : part.slice(at + 1).trim();

    if (!PACKAGE_NAME.test(name)) {
      throw new Error(`release-packages: invalid package name "${name}"`);
    }
    if (out.has(name)) {
      throw new Error(`release-packages: duplicate package "${name}"`);
    }

    if (versionSpec === undefined) {
      out.set(name, { name, bump: 'patch' });
      continue;
    }
    if (versionSpec === '') {
      throw new Error(
        `release-packages: "${name}@" has an empty version spec — ` +
          `drop the @ for a default patch bump, or give patch|minor|major or X.Y.Z`,
      );
    }
    if (BUMPS.has(versionSpec as Bump)) {
      out.set(name, { name, bump: versionSpec as Bump });
      continue;
    }
    try {
      parseSemver(versionSpec);
    } catch {
      throw new Error(
        `release-packages: "${name}@${versionSpec}" — version spec must be ` +
          `patch, minor, major, or a strict semver (X.Y.Z)`,
      );
    }
    out.set(name, { name, version: versionSpec });
  }
  return out;
}

import type { Semver } from './version-types.js';

export function formatSemver(v: Semver): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

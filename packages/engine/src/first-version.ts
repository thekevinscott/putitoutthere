import { parseSemver } from './parse-semver.js';

export function firstVersion(pkg: { first_version?: string }): string {
  const candidate = pkg.first_version ?? '0.1.0';
  parseSemver(candidate);
  return candidate;
}

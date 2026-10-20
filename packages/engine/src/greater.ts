import type { Semver } from './version.js';

export function greater(a: Semver, b: Semver): boolean {
  return (a.major - b.major || a.minor - b.minor || a.patch - b.patch) > 0;
}

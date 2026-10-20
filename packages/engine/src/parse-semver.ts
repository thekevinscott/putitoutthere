import type { Semver } from './version-types.js';

export function parseSemver(s: string): Semver {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(s);
  if (!m) {
    throw new Error(`invalid semver: ${s}`);
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

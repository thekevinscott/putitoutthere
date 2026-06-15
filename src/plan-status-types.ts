/**
 * `plan` publish/skip + skew shared types. The verdict view layered over
 * the build matrix: per package, would a release from this ref PUBLISH,
 * SKIP (already on the registry), or is the registry UNKNOWN (unreachable
 * — reported, never fatal); plus the dependency-skew pairs.
 *
 * Issue #412, #403 slice 4.
 */

import type { MatrixRow } from './plan.js';
import type { Kind } from './types.js';

export type Verdict = 'publish' | 'skip' | 'unknown';

export interface PlanVerdict {
  /** piot package id. */
  package: string;
  kind: Kind;
  /** The version this ref would release for the package. */
  version: string;
  /**
   * `publish` — not yet on the registry; `skip` — already published;
   * `unknown` — the registry couldn't be reached (the read degraded).
   */
  verdict: Verdict;
}

/** A dependent would PUBLISH while a `depends_on` dependency SKIPs. */
export interface SkewWarning {
  dependent: string;
  dependency: string;
}

export interface PlanStatus {
  /** The build matrix — byte-identical to bare `plan` output. */
  matrix: MatrixRow[];
  verdicts: PlanVerdict[];
  skew: SkewWarning[];
}

export interface PlanStatusOptions {
  cwd: string;
  /** Defaults to `${cwd}/putitoutthere.toml`. */
  configPath?: string;
  /** Manual-release spec, forwarded to the real planner. */
  releasePackages?: string | undefined;
}

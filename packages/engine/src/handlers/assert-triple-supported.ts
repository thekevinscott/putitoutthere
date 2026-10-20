import { TRIPLE_MAP } from './npm-platform.js';
import { unmappedTripleMessage } from './unmapped-triple-message.js';

/**
 * Plan-time guard: assert a napi target triple is mapped in `TRIPLE_MAP`
 * before any CI matrix row is emitted for it. Throws with the same
 * vocabulary as `targetToOsCpu`, plus the offending package name so the
 * user knows which `[[package]]` entry to fix.
 *
 * Issue #170 follow-up: failing fast at plan time beats failing
 * mid-publish after a matrix has already run.
 */
export function assertTripleSupported(triple: string, packageName: string): void {
  if (TRIPLE_MAP[triple.toLowerCase()] === undefined) {
    throw new Error(
      `Package "${packageName}": ${unmappedTripleMessage(triple)}`,
    );
  }
}

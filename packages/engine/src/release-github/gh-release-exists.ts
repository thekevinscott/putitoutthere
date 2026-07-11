/**
 * Whether a GitHub Release already exists for `tag` (#444).
 *
 * Wraps `gh release view`, which exits non-zero when the Release is absent.
 * That non-zero is the idempotency guard: a re-run of `release-github`
 * finds the Release present and skips creation instead of erroring. stdout
 * and stderr are discarded (the bash step redirected them to `/dev/null`),
 * and any error — including a genuinely missing Release — resolves to
 * `false`, matching the bash `gh release view … >/dev/null 2>&1` condition.
 */

import { execFileSync } from 'node:child_process';

import type { GhOptions } from './types.js';

export function ghReleaseExists(tag: string, opts: GhOptions = {}): boolean {
  try {
    execFileSync('gh', ['release', 'view', tag], { cwd: opts.cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a GitHub Release already exists for `tag` (#444). Wraps `gh release
 * view`, whose non-zero exit on an absent Release is the idempotency guard: a
 * re-run skips creation instead of erroring. Any error — including a genuinely
 * missing Release — resolves to `false`.
 */

import { execCapture } from '../utils/exec-capture.js';

import type { GhOptions } from './types.js';

export async function ghReleaseExists(tag: string, opts: GhOptions = {}): Promise<boolean> {
  try {
    await execCapture('gh', ['release', 'view', tag], { cwd: opts.cwd });
    return true;
  } catch {
    return false;
  }
}

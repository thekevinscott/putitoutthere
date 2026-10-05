/**
 * Create the GitHub Release for `tag` (#444): `gh release create <tag> --title
 * <tag> --generate-notes`. stdio is inherited so gh's output (the Release URL)
 * reaches the job log, and a non-zero exit throws so a failed create aborts the
 * run rather than being swallowed.
 */

import { execInherit } from '../utils/exec-inherit.js';

import type { GhOptions } from './types.js';

export async function ghReleaseCreate(tag: string, opts: GhOptions = {}): Promise<void> {
  await execInherit('gh', ['release', 'create', tag, '--title', tag, '--generate-notes'], {
    cwd: opts.cwd,
  });
}

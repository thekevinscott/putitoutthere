/**
 * Create the GitHub Release for `tag` (#444).
 *
 * `gh release create <tag> --title <tag> --generate-notes` — auto-generated
 * notes pull PR titles between this tag and the previous one. stdio is
 * inherited so gh's output (the Release URL) reaches the job log, and a
 * non-zero exit throws, matching the bash step's `set -euo pipefail`: a
 * failed create aborts the run rather than being swallowed.
 */

import { execInherit } from '../utils/exec-inherit.js';

import type { GhOptions } from './types.js';

export async function ghReleaseCreate(tag: string, opts: GhOptions = {}): Promise<void> {
  await execInherit('gh', ['release', 'create', tag, '--title', tag, '--generate-notes'], {
    cwd: opts.cwd,
  });
}

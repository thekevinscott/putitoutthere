/**
 * Create the GitHub Release for `tag` (#444).
 *
 * `gh release create <tag> --title <tag> --generate-notes` — auto-generated
 * notes pull PR titles between this tag and the previous one. stdio is
 * inherited so gh's output (the Release URL) reaches the job log, and a
 * non-zero exit throws, matching the bash step's `set -euo pipefail`: a
 * failed create aborts the run rather than being swallowed.
 */

import { execFileSync } from 'node:child_process';

import type { GhOptions } from './types.js';

export function ghReleaseCreate(tag: string, opts: GhOptions = {}): void {
  execFileSync('gh', ['release', 'create', tag, '--title', tag, '--generate-notes'], {
    cwd: opts.cwd,
    stdio: 'inherit',
  });
}

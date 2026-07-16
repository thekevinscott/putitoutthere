/**
 * `putitoutthere release-github` — cut a GitHub Release for each new tag on
 * HEAD (#444, epic #442).
 *
 * Extraction of the inline "Create GitHub Release(s) for new tag(s)" bash
 * step in `.github/workflows/release.yml`. The engine creates annotated
 * git tags and publishes to PyPI / npm / crates.io but does NOT cut GitHub
 * Releases; this backfills them so the project's /releases page tracks the
 * tag history.
 *
 * The contract — previously pinned only by a YAML-text test (#437), now
 * ordinary tested code:
 *
 * - **no-fetch** — never `git fetch`. Local tag state is already complete:
 *   checkout (`fetch-depth: 0`) fetched every remote tag, and the tags
 *   iterated here were created locally by the engine in this same job. A
 *   blanket `git fetch --tags` would reject any tag that moved since
 *   checkout — a consumer's floating major tag, force-moved mid-run by
 *   their promotion automation — failing the job after a fully successful
 *   publish (#436).
 * - **ref-scoped-push** — `git push origin refs/tags/<tag>` per tag,
 *   idempotent and invisible to every other tag, completing the engine's
 *   warn-only tag push (#407) in the same run so `gh release create`
 *   always sees its tag on the remote.
 * - **idempotent-create** — the `gh release view` guard skips a Release
 *   that already exists instead of erroring on a re-run.
 *
 * Returns the process exit code (always 0 on the happy path; a git/gh
 * failure throws out of the loop and the CLI's top-level catch surfaces it
 * as exit 1, matching the bash `set -euo pipefail`).
 */

import { pushTagRef, tagsPointingAtHead } from '../git.js';
import { ghReleaseCreate } from './gh-release-create.js';
import { ghReleaseExists } from './gh-release-exists.js';
import type { ReleaseGithubOptions } from './types.js';

export async function releaseGithub(opts: ReleaseGithubOptions): Promise<number> {
  const gitOpts = { cwd: opts.cwd };
  const tags = tagsPointingAtHead(gitOpts);
  if (tags.length === 0) {
    process.stdout.write('No tags on HEAD; nothing to release on GitHub.\n');
    return 0;
  }
  for (const tag of tags) {
    pushTagRef(tag, gitOpts);
    if (await ghReleaseExists(tag, gitOpts)) {
      process.stdout.write(`GitHub Release ${tag} already exists; skipping.\n`);
      continue;
    }
    await ghReleaseCreate(tag, gitOpts);
    process.stdout.write(`Created GitHub Release for ${tag}\n`);
  }
  return 0;
}

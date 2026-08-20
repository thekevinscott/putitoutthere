/**
 * `publish` shared types: the options the command takes and the
 * per-package release facts it reports.
 *
 * Split out of `publish.ts` so `publish-progress.ts` (#623) can name the
 * `published[]` shape it carries out through a thrown error without
 * importing the orchestrator itself.
 */

import type { Handler, PublishResult } from './types.js';

export interface PublishOptions {
  cwd: string;
  configPath?: string;
  /**
   * Manual-release spec, forwarded verbatim to the internal `plan()`
   * re-run. Must match what the plan job was given so plan and publish
   * agree on the matrix — see the `release_packages` plumbing in
   * `.github/workflows/release.yml`.
   */
  releasePackages?: string | undefined;
  /** Override for tests. */
  handlerFor?: (kind: Handler['kind']) => Handler;
}

export interface PublishOutput {
  ok: boolean;
  published: Array<{
    package: string;
    version: string;
    result: PublishResult;
    /**
     * The git tag cut for this package — the canonical `formatTag`
     * render of its `tag_format` template (#461). Surfaced so the CLI
     * can emit release facts to `$GITHUB_OUTPUT` without reconstructing
     * the tag caller-side.
     */
    tag: string;
  }>;
}

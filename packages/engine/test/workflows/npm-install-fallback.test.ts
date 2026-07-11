/**
 * Workflow-YAML contract: the npm dependency-install step in the
 * reusable workflow must fall back from a strict install (`npm ci`,
 * `pnpm install --frozen-lockfile`) to a non-strict install on
 * failure.
 *
 * Why this exists: bundled-cli / napi npm packages declare
 * `optionalDependencies` for `<name>-<triple>@<version>` platform
 * packages that are produced by *this* pipeline. On the very first
 * publish (or any time the planned version is not yet on the
 * registry), those entries 404. pnpm 10 and recent npm CLIs silently
 * drop 404'd optionals from the lockfile when it is regenerated
 * locally; the lockfile then drifts from `package.json`. A subsequent
 * CI run with `npm ci` / `pnpm install --frozen-lockfile` refuses
 * because the two disagree.
 *
 * The right semantics for a build matrix is "install enough deps to
 * run `npm run build`, accept lockfile drift caused by pre-existence
 * of artifacts this pipeline itself publishes". Strict installs are
 * preserved for the clean case; on failure we fall back with a
 * `::warning::` line so the consumer sees what happened.
 *
 * Hit in the wild on `thekevinscott/darkfactory`'s first release
 * (#integration-2026-05-bundled-cli). All six per-platform npm
 * build jobs failed with `pnpm install --frozen-lockfile` after
 * pnpm had silently dropped the four still-404 platform deps from
 * the consumer's committed lockfile.
 *
 * The fix lives in `.github/workflows/_matrix.yml` (build matrix)
 * and `.github/workflows/release.yml` (the publish-job rebuild step
 * for npm packages added in #256). Both must self-heal for the
 * recipe to "just work out of the box" on first publish.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

function read(file: string): string {
  return readFileSync(join(repoRoot, '.github/workflows', file), 'utf8');
}

// Each pair: a strict install command that must be paired with a
// fallback. We assert both that the strict command is followed by
// `||` (bash short-circuit) and that the matching fallback appears
// inside the failure branch — i.e. the file contains, in order,
// the strict invocation, a `||`, and the fallback invocation,
// with no intervening file boundary.
const STRICT_FALLBACK_PAIRS: ReadonlyArray<{
  label: string;
  strict: RegExp;
  fallback: RegExp;
}> = [
  {
    label: 'pnpm install --frozen-lockfile → pnpm install --no-frozen-lockfile',
    strict: /pnpm\s+install\s+--frozen-lockfile/,
    fallback: /pnpm\s+install\s+--no-frozen-lockfile/,
  },
  {
    label: 'npm ci → npm install',
    strict: /\bnpm\s+ci\b/,
    fallback: /\bnpm\s+install\b/,
  },
];

function assertEachStrictHasFallback(content: string, fileLabel: string): void {
  for (const { label, strict, fallback } of STRICT_FALLBACK_PAIRS) {
    if (!strict.test(content)) continue; // strict invocation absent → not relevant
    // Build a non-anchored regex that requires the strict call,
    // then `||`, then the fallback call, all within ~600 chars
    // (a single bash block). This is not a full bash parser —
    // it's a structural sanity check that the fallback is wired
    // up to *this* strict call rather than appearing elsewhere
    // in the file (the `else` branch's `npm install`, etc.).
    const pairRe = new RegExp(
      `${strict.source}[\\s\\S]{0,600}?\\|\\|[\\s\\S]{0,600}?${fallback.source}`,
      's',
    );
    expect(
      pairRe.test(content),
      `${fileLabel}: ${label}: strict install must be followed by \`||\` and the fallback invocation in the same block. ` +
        `Without the fallback, a stale lockfile (caused by pnpm/npm silently dropping 404'd optionalDependencies for ` +
        `not-yet-published platform packages) fails CI on the first publish of every bundled-cli / napi consumer.`,
    ).toBe(true);
  }
}

describe('reusable workflow: npm install step falls back on lockfile drift', () => {
  it('_matrix.yml build-matrix install step falls back from strict to lenient', () => {
    assertEachStrictHasFallback(read('_matrix.yml'), '_matrix.yml');
  });

  it('release.yml publish-job rebuild step falls back from strict to lenient', () => {
    assertEachStrictHasFallback(read('release.yml'), 'release.yml');
  });

  it('the fallback emits a `::warning::` so the recovery is visible', () => {
    // Both workflows: at least one `::warning::` line near the install
    // step that mentions optionalDependencies / lockfile drift, so a
    // consumer reading the run log understands why the lenient path
    // ran instead of the strict one.
    for (const file of ['_matrix.yml', 'release.yml']) {
      const content = read(file);
      // Only enforce when the file actually has strict installs.
      if (!/npm\s+ci\b|pnpm\s+install\s+--frozen-lockfile/.test(content)) continue;
      expect(
        /::warning::[^\n]*(?:lockfile|optionalDependencies|optional dependencies|drift)/i.test(
          content,
        ),
        `${file}: missing a \`::warning::\` line near the install fallback explaining the recovery. ` +
          `Without it, the consumer sees a successful build with no signal that the strict install failed.`,
      ).toBe(true);
    }
  });
});

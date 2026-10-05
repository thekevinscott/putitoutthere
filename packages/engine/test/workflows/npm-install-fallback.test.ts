/**
 * Workflow-YAML contract: the npm install step must fall back from a strict
 * install (`npm ci`, `--frozen-lockfile`) to a lenient one. On a first publish
 * the platform `optionalDependencies` this pipeline publishes itself 404, so
 * the lockfile drifts and strict refuses — dropping the `||` is invisible (#256).
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

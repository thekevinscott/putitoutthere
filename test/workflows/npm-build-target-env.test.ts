/**
 * Workflow-YAML contract: the `matrix.kind == 'npm'` build step in the
 * reusable workflow must set `TARGET` and `BUILD` env variables so a
 * consumer's `npm run build` script can read them.
 *
 * Why this exists: bundled-cli / napi consumers cross-compile a Rust
 * binary per target and stage it under `build/<triple>/<bin>`. The
 * cross-compile is consumer-owned (npm bundled-cli does not have a
 * maturin-equivalent on the engine side; the build script in the
 * consumer's `package.json` does the work). Without `TARGET` the
 * script has no signal of which triple to build for, so every per-
 * platform matrix row produces an empty `build/<triple>/` directory
 * and `actions/upload-artifact@v7` reports
 * `No files were found with the provided path: ...`.
 *
 * The internal `e2e-fixture-job.yml` already passes
 * `env: { TARGET: ${{ matrix.target }}, BUILD: ${{ matrix.build }} }`
 * (lines 264-270) and the `js-bundled-cli` fixture's
 * `scripts/build.cjs` reads `process.env.TARGET` to know which stub
 * to stage. The reusable workflow's `_matrix.yml` and `release.yml`
 * never picked up that env block — meaning the fixture passes but
 * a real consumer's first publish fails. Hit in the wild on
 * `thekevinscott/darkfactory`'s first release; tracked at #287.
 *
 * The fix: mirror the e2e fixture's env block onto the
 * `matrix.kind == 'npm'` build step in `_matrix.yml` (build matrix)
 * and `release.yml` (publish-job rebuild for npm packages).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

interface Step {
  if?: string;
  name?: string;
  env?: Record<string, string>;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  'working-directory'?: string;
  shell?: string;
}

function loadSteps(file: string, jobKey: string): Step[] {
  const path = join(repoRoot, '.github/workflows', file);
  const doc = parseYaml(readFileSync(path, 'utf8')) as {
    jobs: Record<string, { steps?: Step[] }>;
  };
  const job = doc.jobs[jobKey];
  if (!job) throw new Error(`${file}: job "${jobKey}" not found`);
  return job.steps ?? [];
}

function findNpmRunBuildStep(steps: Step[]): Step | undefined {
  // The relevant step has `if: matrix.kind == 'npm'`, contains
  // `npm run build` in its `run:` body, and is a `run:` step (not a
  // `uses:` step like `actions/setup-node`).
  return steps.find(
    (s) =>
      typeof s.if === 'string' &&
      /matrix\.kind\s*==\s*['"]npm['"]/.test(s.if) &&
      typeof s.run === 'string' &&
      /npm\s+run\s+build/.test(s.run),
  );
}

describe('reusable workflow: npm build step exposes TARGET / BUILD env', () => {
  it('_matrix.yml build-matrix npm step sets TARGET=${{ matrix.target }}', () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const step = findNpmRunBuildStep(steps);
    expect(step, '_matrix.yml: could not find npm `npm run build` step').toBeDefined();
    expect(
      step!.env,
      `_matrix.yml: npm build step has no env block. Without TARGET, bundled-cli/napi consumers' build scripts ` +
        `can't tell which triple to cross-compile for, so every per-platform matrix row uploads an empty ` +
        `\`build/<triple>/\` directory.`,
    ).toBeDefined();
    expect(step!.env!.TARGET).toBe('${{ matrix.target }}');
  });

  it('_matrix.yml build-matrix npm step sets BUILD=${{ matrix.build }}', () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const step = findNpmRunBuildStep(steps);
    expect(step!.env!.BUILD).toBe('${{ matrix.build }}');
  });

  it('release.yml publish-job npm rebuild step sets TARGET (loop variable)', () => {
    // The `release.yml` rebuild loops over npm matrix rows in bash,
    // not via a workflow matrix. The contract there is that `TARGET`
    // and `BUILD` are exported per-iteration for the consumer's
    // `npm run build`. The check looks at the run: body itself
    // rather than a step-level env block.
    const steps = loadSteps('release.yml', 'publish');
    const step = steps.find(
      (s) =>
        typeof s.run === 'string' &&
        /jq\s.*select\(\.kind\s*==\s*"npm"\)/.test(s.run) &&
        /npm\s+run\s+build/.test(s.run),
    );
    expect(
      step,
      'release.yml: could not find publish-job npm rebuild step (the loop over `kind == "npm"` rows that calls `npm run build`)',
    ).toBeDefined();
    // The bash body must export TARGET and BUILD per iteration so the
    // consumer's build script sees them. Symmetric with the build
    // matrix's TARGET handling.
    expect(
      /\bTARGET=/.test(step!.run!),
      `release.yml: npm rebuild loop body must set TARGET per iteration so the consumer's build script ` +
        `can stage the right binary. Without it, the publish-time rebuild produces a different artifact ` +
        `from the build-time matrix and \`npm publish\` ships the wrong tarball contents.`,
    ).toBe(true);
    expect(
      /\bBUILD=/.test(step!.run!),
      `release.yml: npm rebuild loop body must set BUILD per iteration so multi-mode (napi + bundled-cli) ` +
        `consumers' build scripts can dispatch on the mode.`,
    ).toBe(true);
  });
});

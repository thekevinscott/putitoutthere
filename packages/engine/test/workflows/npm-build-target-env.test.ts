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

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

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

/**
 * Workflow-YAML contract: the same npm build step must also set
 * `VERSION` — the version the run is *planning to publish*.
 *
 * Why this exists (#627): `TARGET` and `BUILD` tell a consumer's build
 * script *which triple* to cross-compile and *which mode* to dispatch
 * on, but nothing in the build job tells it *what version it is
 * building*. For a Rust CLI that is the difference between a correct
 * binary and a silently wrong one — cargo bakes `CARGO_PKG_VERSION`
 * from the on-disk `Cargo.toml` at compile time and honors no env
 * override, which is the whole reason `write-crate-version` exists
 * (#366, #374, #429).
 *
 * Every engine-side writer that would supply it is gated off on this
 * path:
 *
 *  - `write-crate-version` (bundled-cli) requires `matrix.bundle_cli`,
 *    so a consumer who declares `build = "bundled-cli"` and does the
 *    cross-compile in their own script never reaches it;
 *  - `write-crate-version` (napi) requires `matrix.build == 'napi'`
 *    *and* a Cargo.toml colocated at `matrix.path`;
 *  - `write-version` requires `matrix.kind == 'pypi' && matrix.build
 *    == 'maturin'`, so an npm row's `package.json` is also still at
 *    the committed literal during the build (the npm version rewrite
 *    happens later, in the publish job).
 *
 * So the roll-your-own build script #287 deliberately supports had no
 * reachable source of truth for the planned version, and the failure
 * is silent: `cargo build` succeeds, the artifact uploads, the publish
 * succeeds, and the shipped binary reports the *previously committed*
 * version. Observed on `thekevinscott/agent-transcripts` 0.0.2 — the
 * npm platform binary printed `0.0.1` while the PyPI wheel built via
 * the maturin path printed `0.0.2`, same commit, same crate.
 *
 * The contract is checked at all three sites the pipeline runs a
 * consumer build script, because a value present at one and absent at
 * another is the drift that made #287 invisible until a real consumer
 * hit it (the fixture passed `TARGET`; the reusable workflow did not):
 *
 *  - `_matrix.yml` (build matrix) — the per-target rows that produce
 *    the artifacts a release actually ships;
 *  - `release.yml` (publish-job rebuild) — the main-row rebuild;
 *  - `e2e-fixture-job.yml` (internal e2e harness) — so the fixture and
 *    the consumer-facing workflow cannot diverge again.
 */
describe('reusable workflow: npm build step exposes VERSION env (#627)', () => {
  it('_matrix.yml build-matrix npm step sets VERSION=${{ matrix.version }}', () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const step = findNpmRunBuildStep(steps);
    expect(step, '_matrix.yml: could not find npm `npm run build` step').toBeDefined();
    expect(
      step!.env!.VERSION,
      `_matrix.yml: npm build step must set VERSION so a roll-your-own bundled-cli build script can stamp ` +
        `Cargo.toml before \`cargo build\` bakes CARGO_PKG_VERSION in. Without it the script has no reachable ` +
        `source of truth for the planned version, and every npm release ships a binary reporting the ` +
        `previously committed one — silently, all the way through publish.`,
    ).toBe('${{ matrix.version }}');
  });

  it('release.yml publish-job npm rebuild step sets VERSION (loop variable)', () => {
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
    expect(
      /\bVERSION=/.test(step!.run!),
      `release.yml: npm rebuild loop body must set VERSION per iteration. The publish-time rebuild runs the ` +
        `same consumer build script the build matrix ran; leaving VERSION unset there hands the script an ` +
        `\`undefined\` at publish time for a value it saw defined at build time — the asymmetry #287 fixed ` +
        `for TARGET / BUILD.`,
    ).toBe(true);
  });

  it('e2e-fixture-job.yml npm build step sets VERSION=${{ matrix.version }}', () => {
    const steps = loadSteps('e2e-fixture-job.yml', 'build');
    const step = findNpmRunBuildStep(steps);
    expect(step, 'e2e-fixture-job.yml: could not find npm `npm run build` step').toBeDefined();
    expect(
      step!.env!.VERSION,
      `e2e-fixture-job.yml: the internal e2e harness must pass VERSION too. When the fixture's env block and ` +
        `the consumer-facing \`_matrix.yml\` disagree, the fixture goes green on a contract real consumers ` +
        `never receive — exactly how #287 stayed invisible until a real first publish hit it.`,
    ).toBe('${{ matrix.version }}');
  });
});

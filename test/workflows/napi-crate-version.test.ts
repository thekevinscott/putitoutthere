/**
 * Workflow-YAML contract: the npm `build = "napi"` path must rewrite the
 * napi crate's version to `matrix.version` BEFORE `npm run build` (which
 * runs the consumer's `napi build`) compiles the `.node`. #429.
 *
 * Why this exists: `napi build` bakes `CARGO_PKG_VERSION` into the `.node`
 * at compile time from whatever literal sits in the crate's Cargo.toml,
 * with no env override — the same problem the maturin `write-version`
 * step (#276) and the npm/pypi bundled-cli `write-crate-version` step
 * (#366) already solve for their build paths. The napi path had no
 * equivalent, so the synthesized per-platform npm package carried the
 * planned version in its package.json while the compiled `.node` inside
 * it reported the stale on-disk crate literal — a library that re-exposes
 * the Rust core's `version()` through napi would report a version
 * diverging from the published npm package.
 *
 * Unlike bundled-cli — whose CLI crate can live at a separate
 * `bundle_cli.crate_path` — the napi crate IS the package's own crate
 * (napi-rs convention: `Cargo.toml` beside `package.json`), so the bump
 * targets `matrix.path`. `write-crate-version` resolves
 * `version.workspace = true` to the workspace root (#428), so a polyglot
 * cargo-workspace napi crate is handled too. The `main` (noarch) row
 * compiles no `.node` and is excluded.
 *
 * Both the consumer-facing reusable workflow (`_matrix.yml`) and its e2e
 * mirror (`e2e-fixture-job.yml`) must carry the step, so the `js-napi`
 * fixture exercises the same path a real consumer's release runs.
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
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
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

/** The consolidated `if: matrix.kind == 'npm'` step that runs `npm run build`. */
function isNpmRunBuild(s: Step): boolean {
  return (
    typeof s.if === 'string' &&
    /matrix\.kind\s*==\s*['"]npm['"]/.test(s.if) &&
    typeof s.run === 'string' &&
    /npm\s+run\s+build/.test(s.run)
  );
}

/** A `write-crate-version` engine invocation gated on the napi build mode. */
function isNapiWriteCrateVersion(s: Step): boolean {
  return (
    typeof s.if === 'string' &&
    /matrix\.build\s*==\s*['"]napi['"]/.test(s.if) &&
    !!s.with &&
    s.with.command === 'write-crate-version'
  );
}

describe('reusable workflow: napi `.node` embeds the release version (#429)', () => {
  it.each([['_matrix.yml'], ['e2e-fixture-job.yml']] as const)(
    '%s writes the napi crate version before `npm run build`',
    (file) => {
      const steps = loadSteps(file, 'build');

      const buildIdx = steps.findIndex(isNpmRunBuild);
      expect(
        buildIdx,
        `${file}: could not find the npm \`npm run build\` step`,
      ).toBeGreaterThanOrEqual(0);

      const writeIdx = steps.findIndex(isNapiWriteCrateVersion);
      expect(
        writeIdx,
        `${file}: the napi build path has no \`write-crate-version\` step. Without it, \`napi build\` ` +
          `bakes the stale on-disk crate version into the .node, so a library exposing the Rust core's ` +
          `version() through napi reports a version diverging from the published npm package.`,
      ).toBeGreaterThanOrEqual(0);

      expect(
        writeIdx,
        `${file}: the napi \`write-crate-version\` step must run BEFORE \`npm run build\` — \`napi build\` ` +
          `reads CARGO_PKG_VERSION from Cargo.toml at compile time.`,
      ).toBeLessThan(buildIdx);
    },
  );

  it.each([
    ['_matrix.yml', '${{ matrix.path }}'],
    ['e2e-fixture-job.yml', 'fixture-tree/${{ matrix.path }}'],
  ] as const)(
    '%s napi write-crate-version targets the package crate path with matrix.version',
    (file, workingDirectory) => {
      const step = loadSteps(file, 'build').find(isNapiWriteCrateVersion);
      expect(step, `${file}: no napi \`write-crate-version\` step found`).toBeDefined();
      expect(
        step!.with!.working_directory,
        `${file}: napi \`write-crate-version\` must target \`matrix.path\` — for napi the compiled crate ` +
          `is the package's own crate (Cargo.toml beside package.json), not a separate bundle_cli crate path.`,
      ).toBe(workingDirectory);
      expect(
        step!.with!.version,
        `${file}: napi \`write-crate-version\` must forward \`matrix.version\` so the .node embeds the ` +
          `planned release version.`,
      ).toBe('${{ matrix.version }}');
    },
  );

  it('the napi write-crate-version step excludes the noarch main row (no .node to compile)', () => {
    const step = loadSteps('_matrix.yml', 'build').find(isNapiWriteCrateVersion);
    expect(step, '_matrix.yml: no napi `write-crate-version` step found').toBeDefined();
    expect(
      step!.if,
      "_matrix.yml: the napi write-crate-version step must gate on `matrix.target != 'main'` — the main " +
        'noarch row runs no per-triple napi build.',
    ).toMatch(/matrix\.target\s*!=\s*['"]main['"]/);
  });
});

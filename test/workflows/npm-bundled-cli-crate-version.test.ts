/**
 * Workflow-YAML contract: every `bundle_cli` cargo-build path in the
 * reusable workflow must rewrite the cross-compiled crate's
 * `[package].version` to `matrix.version` BEFORE the `cargo build` step
 * runs.
 *
 * Why this exists (#366): `cargo build` bakes `CARGO_PKG_VERSION` into
 * the binary at compile time from whatever literal sits in the crate's
 * `Cargo.toml`. There is no env override. The pypi/maturin path already
 * handles this — `_matrix.yml` runs a `write-version` step before
 * `maturin build` so wheels carry `matrix.version`. The npm
 * `bundled-cli` path had no equivalent, so `@scope/cli-<triple>@0.3.5`'s
 * bundled binary reported the stale on-disk crate literal (e.g. `0.2.7`)
 * from `--version` — a silent version skew between the published
 * package and the artifact it ships.
 *
 * #374: the same bug applies to pypi `[package.bundle_cli]` rows. The
 * maturin `write-version` step bumps the Python package version source,
 * not the separate CLI crate at `bundle_cli.crate_path`, so the staged
 * binary can still report the stale crate literal.
 *
 * The fix: a `write-crate-version` step on both npm and pypi bundle_cli
 * paths, invoked against `matrix.bundle_cli.crate_path` with
 * `matrix.version`, immediately before the matching `bundle_cli — cargo
 * build` step in the build matrix.
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

/** The `bundle_cli — cargo build` step for one bundle_cli path. */
function isBundleCliCargoBuild(s: Step, kind: 'npm' | 'pypi'): boolean {
  return (
    typeof s.if === 'string' &&
    new RegExp(`matrix\\.kind\\s*==\\s*['"]${kind}['"]`).test(s.if) &&
    (kind === 'npm'
      ? /matrix\.build\s*==\s*['"]bundled-cli['"]/.test(s.if)
      : /matrix\.build\s*==\s*['"]maturin['"]/.test(s.if)) &&
    typeof s.run === 'string' &&
    /cargo\s+build/.test(s.run)
  );
}

/** A `write-crate-version` engine invocation. */
function isWriteCrateVersion(s: Step, kind: 'npm' | 'pypi'): boolean {
  return (
    typeof s.if === 'string' &&
    new RegExp(`matrix\\.kind\\s*==\\s*['"]${kind}['"]`).test(s.if) &&
    typeof s.uses === 'string' &&
    /putitoutthere/.test(s.uses) &&
    !!s.with &&
    s.with.command === 'write-crate-version'
  );
}

describe('reusable workflow: bundle_cli binaries embed the release version (#366, #374)', () => {
  it.each([
    ['npm', 'bundled-cli'],
    ['pypi', 'maturin bundle_cli'],
  ] as const)('_matrix.yml writes the crate version before the %s %s cargo build', (kind) => {
    const steps = loadSteps('_matrix.yml', 'build');

    const cargoIdx = steps.findIndex((s) => isBundleCliCargoBuild(s, kind));
    expect(
      cargoIdx,
      `_matrix.yml: could not find the ${kind} bundle_cli \`cargo build\` step`,
    ).toBeGreaterThanOrEqual(0);

    const writeIdx = steps.findIndex((s) => isWriteCrateVersion(s, kind));
    expect(
      writeIdx,
      `_matrix.yml: ${kind} bundle_cli has no \`write-crate-version\` step. Without it, ` +
        '`cargo build` bakes the stale on-disk `[package].version` into the binary, so the ' +
        'cross-compiled CLI reports the wrong version from `--version`.',
    ).toBeGreaterThanOrEqual(0);

    expect(
      writeIdx,
      `_matrix.yml: the \`write-crate-version\` step must run BEFORE the ${kind} bundle_cli ` +
        '`cargo build` step — `cargo build` reads `CARGO_PKG_VERSION` from Cargo.toml at ' +
        'compile time.',
    ).toBeLessThan(cargoIdx);
  });

  it.each([
    ['npm', 'bundled-cli'],
    ['pypi', 'maturin bundle_cli'],
  ] as const)('_matrix.yml %s %s write-crate-version targets the crate path with matrix.version', (kind) => {
    const steps = loadSteps('_matrix.yml', 'build');
    const step = steps.find((s) => isWriteCrateVersion(s, kind));
    expect(step, `_matrix.yml: no ${kind} \`write-crate-version\` step found`).toBeDefined();
    expect(
      step!.with!.working_directory,
      '_matrix.yml: `write-crate-version` must target `matrix.bundle_cli.crate_path` — the ' +
        'crate that gets cross-compiled.',
    ).toBe('${{ matrix.bundle_cli.crate_path }}');
    expect(
      step!.with!.version,
      '_matrix.yml: `write-crate-version` must forward `matrix.version` so the binary embeds ' +
        'the planned release version.',
    ).toBe('${{ matrix.version }}');
  });
});

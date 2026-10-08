/**
 * Workflow-YAML contract (#366, #374): every npm and pypi `bundle_cli` cargo
 * path must rewrite the crate's `[package].version` to `matrix.version` BEFORE
 * `cargo build`, which bakes `CARGO_PKG_VERSION` at compile time with no env
 * override — otherwise the shipped binary reports a stale literal, silently.
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

/** The `bundle_cli — cargo build` step for one bundle_cli path. */
function isBundleCliCargoBuild(s: Step, kind: 'npm' | 'pypi'): boolean {
  return (
    typeof s.if === 'string' &&
    new RegExp(`matrix\\.kind\\s*==\\s*['"]${kind}['"]`).test(s.if) &&
    (kind === 'npm'
      ? /matrix\.build\s*==\s*['"]bundled-cli['"]/.test(s.if)
      : /matrix\.build\s*==\s*['"]maturin['"]/.test(s.if)) &&
    ((typeof s.run === 'string' && /cargo\s+build/.test(s.run)) || s.with?.command === 'bundle-cli-build')
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

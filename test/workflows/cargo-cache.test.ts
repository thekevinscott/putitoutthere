/**
 * Workflow-YAML contract: every cargo-heavy step in the reusable
 * build matrix must be preceded by `Swatinem/rust-cache` so per-target
 * matrix cells don't cold-compile every Rust dep on every PR.
 *
 * Why this exists (#391): `_matrix.yml`'s build job runs `cargo build`
 * (for `bundle_cli` paths) and `maturin build` (for every pypi/maturin
 * target row) without any cargo cache. Each matrix cell starts from a
 * cold `~/.cargo/registry` and an empty `target/`, so every dep in the
 * graph (pyo3, napi, libsqlite3-sys, etc.) is downloaded and recompiled
 * from scratch on every PR — even PRs that touch nothing Rust-side.
 *
 * Observed at thekevinscott/dirsql (release-precheck.yml run #125, a
 * typical no-Rust-change PR): individual cells run 4-6 min, full
 * workflow ~8 min. That leaves a downstream CI gate one bad runner-
 * queue minute from tripping a 10-min budget with no headroom.
 *
 * The fix: a `Swatinem/rust-cache@v2` step on the build job, placed
 * before each cargo-invoking step. The cache must be partitioned by
 * `matrix.target` via `shared-key` so each per-target cell keeps its
 * own slot — without partitioning, the last writer's cache contents
 * leak into the next target and trigger a near-miss recompile of every
 * dep (the registry cache is shared, but the per-target `target/` dir
 * is not).
 *
 * The contract this test enforces is the *visible existence* of a
 * cache step before each cargo cost center, plus `shared-key`
 * partitioning. It deliberately does not pin the exact placement (one
 * combined step early in the job, or one step per path, both pass) or
 * the `workspaces` value — those are implementation details. What
 * matters is that no cargo step in the build job is reached without a
 * cache step ahead of it.
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

type Kind = 'npm' | 'pypi';

function gatesOnBundleCliKind(s: Step, kind: Kind): boolean {
  if (typeof s.if !== 'string') return false;
  const ifText = s.if;
  if (!new RegExp(`matrix\\.kind\\s*==\\s*['"]${kind}['"]`).test(ifText)) return false;
  if (!/matrix\.bundle_cli\b/.test(ifText)) return false;
  if (kind === 'npm') {
    return /matrix\.build\s*==\s*['"]bundled-cli['"]/.test(ifText);
  }
  return /matrix\.build\s*==\s*['"]maturin['"]/.test(ifText);
}

function isRustCacheStep(s: Step): boolean {
  return typeof s.uses === 'string' && /^Swatinem\/rust-cache(@|$)/.test(s.uses);
}

function findCargoBuildIdx(steps: Step[], kind: Kind): number {
  return steps.findIndex(
    (s) =>
      gatesOnBundleCliKind(s, kind) &&
      typeof s.name === 'string' &&
      /cargo build/i.test(s.name),
  );
}

function findMaturinBuildIdx(steps: Step[]): number {
  return steps.findIndex(
    (s) =>
      typeof s.uses === 'string' &&
      /^PyO3\/maturin-action(@|$)/.test(s.uses) &&
      !!s.with &&
      s.with.command === 'build',
  );
}

describe('reusable workflow: cargo-heavy build steps run with Swatinem/rust-cache (#391)', () => {
  const cargoBuildPaths = [
    { label: 'npm bundled-cli', kind: 'npm' as Kind },
    { label: 'pypi maturin bundle_cli', kind: 'pypi' as Kind },
  ];

  it.each(cargoBuildPaths)(
    '_matrix.yml: a Swatinem/rust-cache step precedes the $label `cargo build`',
    ({ kind, label }) => {
      const steps = loadSteps('_matrix.yml', 'build');
      const cargoIdx = findCargoBuildIdx(steps, kind);
      expect(
        cargoIdx,
        `_matrix.yml: could not find the ${label} \`cargo build\` step. ` +
          'Expected a step gated on this build path whose `name:` contains "cargo build".',
      ).toBeGreaterThanOrEqual(0);

      const cacheIdx = steps.slice(0, cargoIdx).findIndex(isRustCacheStep);
      expect(
        cacheIdx,
        `_matrix.yml: no \`Swatinem/rust-cache\` step found before the ${label} ` +
          `\`cargo build\` step (index ${cargoIdx}). Every matrix cell currently cold-compiles ` +
          'its full Cargo dep graph because no cache primes `~/.cargo/registry` or the ' +
          'crate `target/` dir. On a wide bundle_cli matrix this dominates wall-clock — ' +
          'observed at 4-6 min per cell with no Rust changes on a downstream consumer (#391). ' +
          'Add a `Swatinem/rust-cache@v2` step before this `cargo build`, with ' +
          '`shared-key: ${{ matrix.target }}` so each per-target cell keeps its own cache slot.',
      ).toBeGreaterThanOrEqual(0);
    },
  );

  it('_matrix.yml: a Swatinem/rust-cache step precedes the `maturin build` step', () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const maturinIdx = findMaturinBuildIdx(steps);
    expect(
      maturinIdx,
      '_matrix.yml: could not find the `PyO3/maturin-action` step with `command: build`. ' +
        'The pypi/maturin path is the largest cargo cost in the workflow (the produced wheel ' +
        'compiles the package crate + every pyo3-dep transitively), and a cache step before ' +
        'this row is the single highest-leverage change for #391.',
    ).toBeGreaterThanOrEqual(0);

    const cacheIdx = steps.slice(0, maturinIdx).findIndex(isRustCacheStep);
    expect(
      cacheIdx,
      `_matrix.yml: no \`Swatinem/rust-cache\` step found before the \`maturin build\` ` +
        `step (index ${maturinIdx}). Maturin shells out to cargo, so the rust-cache action ` +
        'caches it the same way it caches a direct `cargo build`. Without the cache step, ' +
        'every pypi target row recompiles pyo3 and the package\'s entire Rust dep graph cold ' +
        '— the dominant cost on the matrix per #391\'s dirsql evidence.',
    ).toBeGreaterThanOrEqual(0);
  });

  it('_matrix.yml: every Swatinem/rust-cache step in the build job partitions by matrix.target via shared-key', () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const caches = steps.filter(isRustCacheStep);
    expect(
      caches.length,
      '_matrix.yml: no `Swatinem/rust-cache` step found in the build job at all. ' +
        'See the cargo-build and maturin-build cases above for why this matters (#391).',
    ).toBeGreaterThan(0);

    for (const cache of caches) {
      const sharedKey = cache.with?.['shared-key'];
      const sharedKeyStr = typeof sharedKey === 'string' ? sharedKey : '';
      expect(
        sharedKeyStr,
        '_matrix.yml: every `Swatinem/rust-cache` step must set `shared-key` to a value ' +
          'derived from `matrix.target` (e.g. `shared-key: ${{ matrix.target }}`). Without ' +
          'per-target partitioning, the last build of one target overwrites the cache slot ' +
          'used by the next target, and each cell still pays a near-miss recompile because ' +
          'its `target/` dir is wrong-shaped for its triple (#391).',
      ).toMatch(/matrix\.target/);
    }
  });
});

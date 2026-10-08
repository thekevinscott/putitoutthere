/**
 * Workflow-YAML contract: both bundle_cli lanes must produce **dynamically
 * linked** Linux binaries — static-pie has no dynamic loader, so `dlopen` dies
 * with `Dynamic loading not supported` (dirsql#755/#762). npm pins the glibc
 * floor at link time (`putitoutthere bundle-cli-build`, zigbuild at 2.17)
 * instead of #381's static musl; pypi builds the gnu triple direct (#603/#605).
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

function nameMatches(s: Step, pattern: RegExp): boolean {
  return typeof s.name === 'string' && pattern.test(s.name);
}

function findStep(
  steps: Step[],
  kind: Kind,
  namePattern: RegExp,
  runRequirement?: RegExp,
): Step | undefined {
  return steps.find(
    (s) =>
      gatesOnBundleCliKind(s, kind) &&
      nameMatches(s, namePattern) &&
      (runRequirement === undefined || (typeof s.run === 'string' && runRequirement.test(s.run))),
  );
}

describe('reusable workflow: npm bundle_cli Linux binaries are dynamic gnu with a pinned glibc floor (#605)', () => {
  const paths = [
    {
      label: '_matrix.yml npm bundled-cli',
      file: '_matrix.yml',
      job: 'build',
      kind: 'npm' as Kind,
    },
    {
      label: 'e2e-fixture-job.yml npm bundled-cli',
      file: 'e2e-fixture-job.yml',
      job: 'build',
      kind: 'npm' as Kind,
    },
  ];

  // The contract is "no gnu→musl *substitution*", not "the string
  // `linux-musl` never appears". A consumer may DECLARE a musl triple, and
  // the steps branch on that deliberately (see the declared-musl describe
  // below). What must stay gone is the derivation the lane used to perform:
  // `${RUST_TARGET//-linux-gnu/-linux-musl}` into a `BINARY_TARGET` that the
  // rest of the step then consumed.
  function expectNoMuslMapping(run: string, contextMsg: string): void {
    const why =
      `${contextMsg}: the npm bundle_cli step must not derive a musl-mapped ` +
      'triple from a declared gnu one. A musl build is statically linked, and ' +
      'a static binary cannot dlopen — SQLite extension loading through the ' +
      'published npm CLI fails with `Dynamic loading not supported` (#605, ' +
      'dirsql#762). Portability is now pinned at link time instead (zigbuild ' +
      'against GLIBC_FLOOR), so consume the declared triple directly.';
    expect(run, why).not.toMatch(/-linux-gnu\/-linux-musl/);
    expect(run, why).not.toMatch(/\bBINARY_TARGET\b/);
  }

  it.each(paths)('$label: `rustup target add` registers the declared triple', ({ file, job, kind, label }) => {
    const steps = loadSteps(file, job);
    const step = findStep(steps, kind, /add Rust target/i, /rustup\s+target\s+add/);
    expect(
      step,
      `${label}: could not locate the \`bundle_cli — add Rust target\` step. ` +
        'Expected a step gated on this build path whose name contains "add Rust target" ' +
        'and whose run block calls `rustup target add`.',
    ).toBeDefined();
    const run = step!.run!;
    expectNoMuslMapping(run, `${label}: rustup-target-add`);
    expect(
      run,
      `${label}: rustup-target-add must consume \`$RUST_TARGET\` directly (#605)`,
    ).toMatch(/rustup\s+target\s+add\s+"\$\{?RUST_TARGET\}?"/);
  });

  it.each(paths)("$label: stage step reads from the declared triple's target dir", ({ file, job, kind, label }) => {
    const steps = loadSteps(file, job);
    const step = findStep(steps, kind, /stage binary/i, /src=/);
    expect(
      step,
      `${label}: could not locate the \`bundle_cli — stage binary\` step. ` +
        'Expected a step gated on this build path whose name contains "stage binary" ' +
        'and whose run block sets a `src=` variable.',
    ).toBeDefined();
    const run = step!.run!;
    expectNoMuslMapping(run, `${label}: stage-binary`);
    expect(
      run,
      `${label}: stage-binary must read from \`target/$RUST_TARGET/release\` — ` +
        'zigbuild strips the `.GLIBC_FLOOR` suffix from the output dir, so the ' +
        'declared triple is the on-disk path (#605).',
    ).toMatch(/target\/"?\$\{?RUST_TARGET\}?"?\/release/);
  });

  it.each(paths)('$label: a zigbuild toolchain install step precedes cargo build; musl-tools is gone', ({ file, job, kind, label }) => {
    const steps = loadSteps(file, job);

    const zigIdx = steps.findIndex(
      (s) => typeof s.run === 'string' && /zigbuild/.test(s.run) && /install/i.test(s.run),
    );
    expect(
      zigIdx,
      `${label}: no step installs cargo-zigbuild. The Linux cargo build goes ` +
        'through `cargo zigbuild`, which is not pre-installed on the runners — ' +
        'add an install step (e.g. `pip3 install cargo-zigbuild ziglang`) gated ' +
        'on the Linux bundle_cli path, ordered before the cargo build step (#605).',
    ).toBeGreaterThanOrEqual(0);

    const cargoStep = findStep(steps, kind, /cargo build/i);
    expect(cargoStep, `${label}: cargo build step not found`).toBeDefined();
    const cargoBuildIdx = steps.indexOf(cargoStep!);
    expect(
      zigIdx,
      `${label}: zigbuild toolchain install (index ${zigIdx}) must appear ` +
        `before cargo build (index ${cargoBuildIdx}).`,
    ).toBeLessThan(cargoBuildIdx);

    const muslToolsIdx = steps.findIndex(
      (s) => typeof s.run === 'string' && /musl.?tools/.test(s.run),
    );
    expect(
      muslToolsIdx,
      `${label}: a step still installs musl-tools (step index ${muslToolsIdx}). ` +
        'With no lane musl-mapping anymore (#603 removed pypi, #605 removes npm), ' +
        'the musl C cross-compiler has no consumer and the step must be removed.',
    ).toBe(-1);
  });
});

describe('reusable workflow: bundle_cli stage binary runs AFTER npm run build (#384)', () => {
  // The root cause of #384: the engine stages the musl binary BEFORE
  // `npm run build`. A consumer build script that also runs cargo
  // with the raw TARGET (a -linux-gnu triple) and stages to the same
  // `build/<triple>/` path will overwrite the musl binary with a
  // glibc binary. The verify step then passes the existence check but
  // ships a dynamically-linked artifact. Fix: move the stage step to
  // AFTER npm run build so the engine-built binary always wins.
  const paths = [
    { label: '_matrix.yml', file: '_matrix.yml', job: 'build', kind: 'npm' as Kind },
    { label: 'e2e-fixture-job.yml', file: 'e2e-fixture-job.yml', job: 'build', kind: 'npm' as Kind },
  ];

  it.each(paths)(
    '$label: bundle_cli — stage binary step appears after the npm install+build step',
    ({ file, job, kind, label }) => {
      const steps = loadSteps(file, job);
      const stageStep = findStep(steps, kind, /stage binary/i, /src=/);
      expect(
        stageStep,
        `${label}: could not locate the \`bundle_cli — stage binary\` step. ` +
          'Expected a step gated on npm/bundled-cli whose name contains "stage binary" ' +
          'and whose run block sets a `src=` variable.',
      ).toBeDefined();
      const stageIdx = steps.indexOf(stageStep!);

      const npmBuildIdx = steps.findIndex(
        (s) => s.with?.command === 'npm-build' || (typeof s.run === 'string' && s.run.includes('npm run build --if-present')),
      );
      expect(
        npmBuildIdx,
        `${label}: no step containing \`npm run build --if-present\` found in the build job`,
      ).toBeGreaterThanOrEqual(0);

      expect(
        stageIdx,
        `${label}: \`bundle_cli — stage binary\` (step index ${stageIdx}) must appear ` +
          `AFTER the npm install+build step (index ${npmBuildIdx}). ` +
          'When staging runs first, a consumer build script that stages a glibc binary ' +
          'under the same `build/<triple>/` path overwrites the engine-built binary. ' +
          'The verify step then sees a dynamically-linked artifact that fails at runtime ' +
          'on any Linux with glibc < 2.39 (#384).',
      ).toBeGreaterThan(npmBuildIdx);
    },
  );
});

describe('reusable workflow: pypi bundle_cli binaries are compiled against the declared gnu triple (#603)', () => {
  // A statically-linked musl binary cannot `dlopen`, so a consumer CLI that
  // loads SQLite extensions fails at runtime with `Dynamic loading not
  // supported` (dirsql#755). Unlike npm, the pypi lane needs no musl
  // mapping for portability: everything compiled on the runner shares the
  // runner's glibc, the wheel's manylinux platform tag encodes that floor,
  // and pip refuses to install the wheel on any older system — so a
  // dynamically-linked gnu binary has exactly the wheel's own reach. The
  // pypi bundle_cli steps must therefore consume `$TARGET` directly, with
  // no gnu→musl substitution and no musl toolchain step.
  const label = '_matrix.yml pypi maturin bundle_cli';

  function expectNoMuslMapping(run: string, contextMsg: string): void {
    expect(
      run,
      `${contextMsg}: the pypi bundle_cli step must not derive a musl-mapped ` +
        'triple. A musl build is statically linked, and a static binary cannot ' +
        'dlopen — SQLite extension loading in the shipped wheel fails with ' +
        '`Dynamic loading not supported` (#603, dirsql#755). The wheel\'s ' +
        'manylinux tag already gates the glibc floor, so compile the declared ' +
        'gnu triple directly.',
    ).not.toMatch(/linux-musl/);
  }

  it(`${label}: \`rustup target add\` registers the declared triple`, () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const step = findStep(steps, 'pypi', /add Rust target/i, /rustup\s+target\s+add/);
    expect(step, `${label}: \`bundle_cli — add Rust target\` step not found`).toBeDefined();
    const run = step!.run!;
    expectNoMuslMapping(run, `${label}: rustup-target-add`);
    expect(
      run,
      `${label}: rustup-target-add must consume \`$TARGET\` directly (#603)`,
    ).toMatch(/rustup\s+target\s+add\s+"\$\{?TARGET\}?"/);
  });

  it(`${label}: \`cargo build --target\` compiles the declared triple`, () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const step = findStep(steps, 'pypi', /cargo build/i);
    expect(step, `${label}: \`bundle_cli — cargo build\` step not found`).toBeDefined();
    const run = step!.run!;
    expectNoMuslMapping(run, `${label}: cargo-build`);
    expect(
      run,
      `${label}: cargo-build must consume \`$TARGET\` directly (#603)`,
    ).toMatch(/--target\s+"\$\{?TARGET\}?"/);
  });

  it(`${label}: stage step reads from the declared triple's target dir`, () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const step = findStep(steps, 'pypi', /stage binary/i, /src=/);
    expect(step, `${label}: \`bundle_cli — stage binary\` step not found`).toBeDefined();
    const run = step!.run!;
    expectNoMuslMapping(run, `${label}: stage-binary`);
    expect(
      run,
      `${label}: stage-binary must read from \`target/$TARGET/release\` (#603)`,
    ).toMatch(/target\/"?\$\{?TARGET\}?"?\/release/);
  });

  it(`${label}: stage step's not-found diagnostic references no dropped variable`, () => {
    // The gnu→musl mapping bound `BINARY_TARGET` and every read in the step
    // went through it. #603 removed the binding but the "cargo build did not
    // produce <src>" branch still lists `target/${BINARY_TARGET}/release/`.
    // Under `set -euo pipefail` that expansion is an unbound-variable error,
    // so the branch dies before printing anything: the one moment a consumer
    // needs the directory listing is the one moment it is replaced by
    // `BINARY_TARGET: unbound variable`.
    const steps = loadSteps('_matrix.yml', 'build');
    const step = findStep(steps, 'pypi', /stage binary/i, /src=/);
    expect(step, `${label}: \`bundle_cli — stage binary\` step not found`).toBeDefined();
    expect(
      step!.run!,
      `${label}: the stage step still expands \`$BINARY_TARGET\`, a variable ` +
        'nothing binds since the gnu→musl mapping was removed (#603). Under ' +
        '`set -u` that aborts the failure branch instead of printing the ' +
        'directory listing it exists to print — use `$TARGET`, the triple the ' +
        'step actually built and read.',
    ).not.toMatch(/\bBINARY_TARGET\b/);
  });

  it(`${label}: no pypi-gated step installs the musl C toolchain`, () => {
    const steps = loadSteps('_matrix.yml', 'build');
    const muslToolchainStep = steps.find(
      (s) =>
        gatesOnBundleCliKind(s, 'pypi') &&
        typeof s.run === 'string' &&
        /musl.?tools/.test(s.run),
    );
    expect(
      muslToolchainStep,
      `${label}: found a pypi-gated step installing musl-tools ` +
        `(${muslToolchainStep?.name ?? 'unnamed'}). The pypi lane compiles the ` +
        'declared gnu triple (#603), so the musl C cross-compiler step must be ' +
        'removed along with the gnu→musl mapping.',
    ).toBeUndefined();
  });
});

describe('reusable workflow: npm bundled-cli reads the engine-resolved Rust triple from matrix.rust_target (#387)', () => {
  // `matrix.target` for npm bundled-cli rows is an napi-rs short-form triple
  // (linux-x64-gnu, …), not a Rust triple: rustup answers `does not support
  // target 'linux-x64-gnu'`. #387 moved the mapping into the engine
  // (`matrix.rust_target`), so a surviving inline `case` table is the regression.
  const npmPaths = [
    { label: '_matrix.yml npm bundled-cli', file: '_matrix.yml', job: 'build' },
    { label: 'e2e-fixture-job.yml npm bundled-cli', file: 'e2e-fixture-job.yml', job: 'build' },
  ];

  // A literal Rust-triple component, present only if an inline napi→rust
  // mapping survives in the shell.
  const inlineRustTriple = /unknown-linux|apple-darwin|pc-windows-msvc/;

  function envReferencesRustTarget(step: Step): boolean {
    return Object.values({ ...step.env, ...step.with }).some((v) => /matrix\.rust_target/.test(String(v)));
  }

  const affectedSteps: { label: string; find: (steps: Step[]) => Step | undefined }[] = [
    { label: 'add Rust target', find: (s) => findStep(s, 'npm', /add Rust target/i, /rustup\s+target\s+add/) },
    { label: 'cargo build', find: (s) => findStep(s, 'npm', /cargo build/i) },
    { label: 'stage binary', find: (s) => findStep(s, 'npm', /stage binary/i, /src=/) },
  ];

  for (const { label: fileLabel, file, job } of npmPaths) {
    for (const { label: stepLabel, find } of affectedSteps) {
      it(`${fileLabel}: \`${stepLabel}\` reads matrix.rust_target and carries no inline napi→rust mapping`, () => {
        const step = find(loadSteps(file, job));
        expect(step, `${fileLabel}: \`${stepLabel}\` step not found`).toBeDefined();

        expect(
          envReferencesRustTarget(step!),
          `${fileLabel} \`${stepLabel}\`: the step must bind an env var to ` +
            '`${{ matrix.rust_target }}` (the engine-resolved Rust triple from ' +
            "plan.ts's toRustTriple) and consume it, instead of mapping the " +
            'npm-flavor matrix.target to a Rust triple inline. Without this the ' +
            "napi→rust correspondence is duplicated in shell and drifts from the " +
            "engine's TRIPLE_MAP (#387).",
        ).toBe(true);

        expect(
          step!.run ?? '',
          `${fileLabel} \`${stepLabel}\`: the run block must NOT contain an inline ` +
            'napi→rust lookup. A literal Rust-triple component (`unknown-linux`, ' +
            '`apple-darwin`, `pc-windows-msvc`) only appears if a `case` / lookup ' +
            'table survived in the shell — the mapping belongs in the engine ' +
            '(plan.ts → matrix.rust_target), read here as `$RUST_TARGET` (#387).',
        ).not.toMatch(inlineRustTriple);
      });
    }
  }
});

/**
 * Workflow-YAML contract: every `bundle_cli` cargo-build path in the
 * reusable workflow (and its e2e mirror) must compile the binary against
 * a musl target on Linux, regardless of the gnu triple the package
 * declares.
 *
 * Why this exists (#381): `cargo build --target $TARGET` runs directly
 * on the GitHub-hosted runner. `ubuntu-latest` resolves to Ubuntu 24.04
 * (glibc 2.39), so the produced binary carries a GLIBC_2.39 symbol
 * requirement and fails at runtime on any older Linux:
 *
 *   ./bin: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found
 *
 * The fix: derive a `BINARY_TARGET` from `TARGET` that swaps
 * `-linux-gnu*` to `-linux-musl*`, and use `BINARY_TARGET` for the
 * three bundle_cli steps that compile and locate the binary
 * (`rustup target add`, `cargo build --target`, and the stage step's
 * `src=…/target/<triple>/…` path). `TARGET` itself stays unchanged
 * everywhere else (npm package naming, napi build, wheel tag, artifact
 * name), so the package's declared triple and the bundled binary's
 * compile triple become independent concerns. Static musl binaries
 * have no glibc floor and run on any Linux ≥ kernel 3.2.
 *
 * The contract this test enforces is the *visible substitution*: in
 * each of the three steps per bundle_cli path, the `run:` block must
 * reference `linux-gnu` and `linux-musl` together (a substitution
 * pattern between them, e.g. `${TARGET//-linux-gnu/-linux-musl}`),
 * and the cargo / rustup / stage operations must consume the derived
 * binary triple rather than `$TARGET` directly. The test deliberately
 * does not pin the exact shell syntax — a future refactor that uses
 * `case`, `sed`, or another mechanism for the swap stays passing as
 * long as the substitution is visible and the derived variable is the
 * one passed downstream.
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

/** Asserts the run block visibly substitutes `linux-gnu` → `linux-musl`. */
function expectGnuToMuslSubstitution(run: string, contextMsg: string): void {
  expect(
    run,
    `${contextMsg}: the step must derive a musl-mapped triple from \`$TARGET\`. ` +
      'Expected to find both `linux-gnu` and `linux-musl` in the shell block ' +
      '(e.g. `BINARY_TARGET="${TARGET//-linux-gnu/-linux-musl}"`) so that Linux ' +
      "binaries are compiled as static musl regardless of the package's declared " +
      'target triple. Without this, the binary picks up the build runner\'s glibc ' +
      'version (#381) and fails at runtime on any older Linux.',
  ).toMatch(/linux-gnu[\s\S]*linux-musl|linux-musl[\s\S]*linux-gnu/);
}

/**
 * Asserts the run block uses the derived binary triple — *not* bare
 * `$TARGET` — in the position that matters for this step (cargo
 * --target, rustup target add, or the stage `src=` path).
 */
function expectDerivedTripleUsed(
  run: string,
  consumerPattern: RegExp,
  contextMsg: string,
): void {
  expect(
    run,
    `${contextMsg}: the operation must consume the derived musl-mapped triple, ` +
      'not `$TARGET` directly. The whole point of the derivation is to feed it ' +
      'into this step (#381).',
  ).toMatch(consumerPattern);
}

describe('reusable workflow: bundle_cli Linux binaries are compiled as static musl (#381)', () => {
  const paths = [
    {
      label: '_matrix.yml pypi maturin bundle_cli',
      file: '_matrix.yml',
      job: 'build',
      kind: 'pypi' as Kind,
    },
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

  it.each(paths)('$label: `rustup target add` uses the musl-mapped triple', ({ file, job, kind, label }) => {
    const steps = loadSteps(file, job);
    const step = findStep(steps, kind, /add Rust target/i, /rustup\s+target\s+add/);
    expect(
      step,
      `${label}: could not locate the \`bundle_cli — add Rust target\` step. ` +
        'Expected a step gated on this build path whose name contains "add Rust target" ' +
        'and whose run block calls `rustup target add`.',
    ).toBeDefined();
    const run = step!.run!;
    expectGnuToMuslSubstitution(run, `${label}: rustup-target-add`);
    expectDerivedTripleUsed(
      run,
      /rustup\s+target\s+add\s+"\$\{?[A-Z_]*(BINARY|MUSL)[A-Z_]*\}?"/,
      `${label}: rustup-target-add`,
    );
  });

  it.each(paths)('$label: `cargo build --target` uses the musl-mapped triple', ({ file, job, kind, label }) => {
    const steps = loadSteps(file, job);
    // Lookup by name only — `cargo build` uniquely identifies this step
    // among the bundle_cli path's gated steps. A run-block predicate that
    // requires `cargo` before `build` would miss the pypi shape, where
    // the invocation is split (`args=(build …); cargo "${args[@]}"`).
    const step = findStep(steps, kind, /cargo build/i);
    expect(
      step,
      `${label}: could not locate the \`bundle_cli — cargo build\` step. ` +
        'Expected a step gated on this build path whose name contains "cargo build".',
    ).toBeDefined();
    expect(
      step!.run,
      `${label}: cargo-build step has no \`run:\` block`,
    ).toBeDefined();
    const run = step!.run!;
    expectGnuToMuslSubstitution(run, `${label}: cargo-build`);
    expectDerivedTripleUsed(
      run,
      /--target\s+"\$\{?[A-Z_]*(BINARY|MUSL)[A-Z_]*\}?"/,
      `${label}: cargo-build`,
    );
  });

  it.each(paths)('$label: stage step reads from the musl-mapped target dir', ({ file, job, kind, label }) => {
    const steps = loadSteps(file, job);
    const step = findStep(steps, kind, /stage binary/i, /src=/);
    expect(
      step,
      `${label}: could not locate the \`bundle_cli — stage binary\` step. ` +
        'Expected a step gated on this build path whose name contains "stage binary" ' +
        'and whose run block sets a `src=` variable.',
    ).toBeDefined();
    const run = step!.run!;
    expectGnuToMuslSubstitution(run, `${label}: stage-binary`);
    expectDerivedTripleUsed(
      run,
      /target\/\$\{?[A-Z_]*(BINARY|MUSL)[A-Z_]*\}?\/release/,
      `${label}: stage-binary`,
    );
  });
});

describe('e2e fixture: bundle_cli verify step asserts the Linux binary is statically linked (#384)', () => {
  // The bundle_cli — verify step in e2e-fixture-job.yml currently only checks
  // that the staged binary *exists*. A dynamically-linked glibc binary passes
  // that check silently and ships to npm consumers, where it breaks at runtime
  // on any Linux with glibc < 2.39 (#384). The verify step must also assert
  // the binary is statically linked (ldd / file check) so a regression
  // reintroducing glibc linkage is caught in CI before the artifact is published.
  it(
    'bundle_cli — verify step in e2e-fixture-job.yml checks that the Linux binary ' +
      'is not dynamically linked against glibc',
    () => {
      const steps = loadSteps('e2e-fixture-job.yml', 'build');
      const verifyStep = steps.find(
        (s) =>
          gatesOnBundleCliKind(s, 'npm') &&
          nameMatches(s, /verify/i) &&
          typeof s.run === 'string',
      );
      expect(
        verifyStep,
        'e2e-fixture-job.yml: could not find the `bundle_cli — verify` step. ' +
          'Expected a step gated on npm/bundled-cli whose name contains "verify" ' +
          'and whose run block checks the staged binary.',
      ).toBeDefined();
      const run = verifyStep!.run!;
      expect(
        run,
        'e2e-fixture-job.yml bundle_cli — verify: the run block must assert that ' +
          'the Linux binary is statically linked — not just that it exists. ' +
          'Expected to find `ldd` or a reference to "dynamically linked" / ' +
          '"statically linked" / "static-pie" in the shell block so that a ' +
          'glibc-linked binary (#384) causes the e2e build job to fail before ' +
          "the artifact is uploaded. Without this check a regression that reintroduces " +
          'dynamic glibc linkage ships silently to npm consumers.',
      ).toMatch(/\bldd\b|dynamically.linked|statically.linked|static.pie/i);
    },
  );
});

describe('reusable workflow: bundle_cli stage binary runs AFTER npm run build (#384)', () => {
  // The root cause of #384: the engine stages the musl binary BEFORE
  // `npm run build`. A consumer build script that also runs cargo
  // with the raw TARGET (a -linux-gnu triple) and stages to the same
  // `build/<triple>/` path will overwrite the musl binary with a
  // glibc binary. The verify step then passes the existence check but
  // ships a dynamically-linked artifact. Fix: move the stage step to
  // AFTER npm run build so the engine's musl binary always wins.
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
        (s) => typeof s.run === 'string' && s.run.includes('npm run build --if-present'),
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
          'under the same `build/<triple>/` path overwrites the engine\'s musl binary. ' +
          'The verify step then sees a dynamically-linked artifact that fails at runtime ' +
          'on any Linux with glibc < 2.39 (#384).',
      ).toBeGreaterThan(npmBuildIdx);
    },
  );
});

describe('reusable workflow: _matrix.yml bundle_cli verify step asserts static linking (#384)', () => {
  // The e2e-fixture-job.yml verify step (added in #384 / PR #385) already checks
  // that the Linux binary is statically linked. The consumer-facing _matrix.yml
  // must carry the same guard so real consumers' build jobs catch a dynamically-
  // linked regression before the artifact is uploaded to the registry.
  it(
    '_matrix.yml bundle_cli — verify step checks that the Linux binary is not dynamically linked',
    () => {
      const steps = loadSteps('_matrix.yml', 'build');
      const verifyStep = steps.find(
        (s) =>
          gatesOnBundleCliKind(s, 'npm') &&
          nameMatches(s, /verify/i) &&
          typeof s.run === 'string',
      );
      expect(
        verifyStep,
        '_matrix.yml: could not find the `bundle_cli — verify` step. ' +
          'Expected a step gated on npm/bundled-cli whose name contains "verify" ' +
          'and whose run block checks the staged binary.',
      ).toBeDefined();
      const run = verifyStep!.run!;
      expect(
        run,
        '_matrix.yml bundle_cli — verify: the run block must assert that ' +
          'the Linux binary is statically linked — not just that it exists. ' +
          'Expected to find `ldd` or a reference to "dynamically linked" / ' +
          '"statically linked" / "static-pie" in the shell block so that a ' +
          'glibc-linked binary causes the build job to fail before upload. ' +
          'The e2e-fixture-job.yml verify step already has this check; the ' +
          'consumer-facing _matrix.yml must carry it too (#384).',
      ).toMatch(/\bldd\b|dynamically.linked|statically.linked|static.pie/i);
    },
  );
});

describe('reusable workflow: bundle_cli musl builds install musl-tools C compiler', () => {
  // `rustup target add` installs the Rust musl target but not the C cross-compiler.
  // Crates that compile C source (libsqlite3-sys --bundled, openssl-sys, etc.) invoke
  // x86_64-linux-musl-gcc at cargo build time. That binary lives in the musl-tools apt
  // package, which is absent on ubuntu-latest. Without it, cargo fails with:
  //   failed to find tool "x86_64-linux-musl-gcc": No such file or directory
  const paths = [
    {
      label: '_matrix.yml pypi maturin bundle_cli',
      file: '_matrix.yml',
      job: 'build',
      kind: 'pypi' as Kind,
    },
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

  it('a musl-tools install step exists and precedes cargo build in every bundle_cli path', () => {
    for (const { file, job, kind, label } of paths) {
      const steps = loadSteps(file, job);

      const musltoolsIdx = steps.findIndex(
        (s) => typeof s.run === 'string' && /musl.?tools/.test(s.run),
      );

      expect(
        musltoolsIdx,
        `${label}: no step installs musl-tools. ` +
          'Crates that compile C source (e.g. libsqlite3-sys with features = ["bundled"]) ' +
          'need x86_64-linux-musl-gcc, which the musl-tools apt package provides. ' +
          'It is not pre-installed on ubuntu-latest, so cargo build fails with: ' +
          '"failed to find tool \\"x86_64-linux-musl-gcc\\"". ' +
          'Add a step with `sudo apt-get install -y musl-tools` gated on the Linux ' +
          'musl target path, ordered before the cargo build step.',
      ).toBeGreaterThanOrEqual(0);

      const cargoStep = findStep(steps, kind, /cargo build/i);
      expect(cargoStep, `${label}: cargo build step not found`).toBeDefined();
      const cargoBuildIdx = steps.indexOf(cargoStep!);

      expect(
        musltoolsIdx,
        `${label}: musl-tools install step (index ${musltoolsIdx}) must appear ` +
          `before cargo build (index ${cargoBuildIdx}).`,
      ).toBeLessThan(cargoBuildIdx);
    }
  });
});

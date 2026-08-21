/**
 * Workflow-YAML contract: both bundle_cli lanes in the reusable workflow
 * (and the npm lane's e2e mirror) must produce **dynamically linked**
 * Linux binaries — a static (static-pie) binary has no dynamic loader, so
 * any runtime `dlopen` fails and consumer CLIs that load SQLite extensions
 * die with `Dynamic loading not supported` (dirsql#755, dirsql#762). The
 * two lanes get there differently, because their portability stories
 * differ:
 *
 * **pypi (#603)**: compile the declared gnu triple directly. The wheel's
 * manylinux platform tag already encodes the glibc floor of everything
 * built on the runner, and pip refuses to install the wheel anywhere
 * older — a dynamically linked gnu binary has exactly the wheel's own
 * reach.
 *
 * **npm (#605)**: npm has **no install-time glibc gate**, so a plain gnu
 * build would carry the runner's glibc (2.39 on ubuntu-latest) and fail
 * at runtime on any older distro:
 *
 *   ./bin: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found
 *
 * That was #381's rationale for static musl — which traded away `dlopen`.
 * The lane now pins the floor at **link time** instead: `cargo zigbuild
 * --target "$RUST_TARGET.$GLIBC_FLOOR"` links against a chosen old glibc
 * (2.17, the manylinux2014 baseline) regardless of the runner's, so the
 * binary is dynamic (dlopen works) AND runs on every glibc distro since
 * 2012. musl-libc distros (Alpine) are unaffected either way: the
 * synthesized platform packages declare `libc: ["glibc"]`, so npm's own
 * libc gating never installs them there.
 *
 * The npm contract this test enforces per affected step: the declared
 * Rust triple (`$RUST_TARGET`) is consumed directly — no gnu→musl
 * substitution anywhere — the cargo build goes through `zigbuild` with a
 * pinned `GLIBC_FLOOR`, and the verify step asserts BOTH that the staged
 * Linux binary is dynamically linked AND that its max versioned
 * `GLIBC_*` symbol stays within the floor (the ceiling check catches the
 * #381/#189 regression the static assert used to guard against, without
 * giving up dlopen). The tests deliberately do not pin exact shell
 * syntax — refactors stay passing as long as the contract is visible.
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

function envBindsRustTarget(s: Step): boolean {
  return Object.values(s.env ?? {}).some((v) => /matrix\.rust_target/.test(String(v)));
}

/**
 * The text of the `case` arm that handles a declared musl triple: from the
 * `*-linux-musl*` pattern token through the arm's `;;`. Returns undefined when
 * no arm mentions musl at all, which is the shape this file's declared-musl
 * describe rejects.
 */
function declaredMuslArm(run: string): string | undefined {
  const arm = run.split(';;').find((segment) => /-linux-musl/.test(segment));
  if (arm === undefined) return undefined;
  return arm.slice(arm.indexOf('-linux-musl'));
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

  it.each(paths)('$label: `cargo build` goes through zigbuild pinned to GLIBC_FLOOR on Linux', ({ file, job, kind, label }) => {
    const steps = loadSteps(file, job);
    const step = findStep(steps, kind, /cargo build/i);
    expect(
      step,
      `${label}: could not locate the \`bundle_cli — cargo build\` step. ` +
        'Expected a step gated on this build path whose name contains "cargo build".',
    ).toBeDefined();
    const run = step!.run!;
    expectNoMuslMapping(run, `${label}: cargo-build`);
    expect(
      run,
      `${label}: cargo-build must invoke \`cargo zigbuild\` for Linux targets so the ` +
        'binary is dynamically linked against a *pinned old* glibc rather than the ' +
        "runner's (#605). A plain `cargo build` on ubuntu-latest floors the binary " +
        'at the runner glibc (2.39) and re-introduces the #381 runtime breakage; ' +
        'static musl cannot dlopen. zigbuild is the only shape that avoids both.',
    ).toMatch(/\bzigbuild\b/);
    expect(
      run,
      `${label}: the zigbuild target must carry the pinned glibc floor suffix ` +
        '(`--target "$RUST_TARGET.$GLIBC_FLOOR"`), so the floor is explicit and ' +
        'testable rather than inherited from the runner (#605).',
    ).toMatch(/--target\s+"\$\{?RUST_TARGET\}?\.\$\{?GLIBC_FLOOR\}?"/);
    expect(
      `${JSON.stringify(step!.env ?? {})}\n${run}`,
      `${label}: the glibc floor must be pinned at 2.17 (the manylinux2014 ` +
        'baseline) — old enough to cover every glibc distro since 2012, and the ' +
        'value the verify step enforces as a symbol ceiling (#605).',
    ).toMatch(/2\.17/);
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

describe('npm bundle_cli verify: asserts dynamic linkage and the pinned glibc ceiling (#605)', () => {
  // The #384 verify step asserted the Linux binary was statically linked —
  // which, post-#605, would enforce the dlopen defect. The contract
  // inverts and strengthens: a static binary is now the FAILURE case
  // (it cannot dlopen), and the portability property #384 actually cared
  // about is enforced directly instead, as a symbol ceiling — the max
  // versioned GLIBC_* requirement of the staged binary must stay within
  // the pinned GLIBC_FLOOR the build linked against. The ceiling check
  // catches a regression to runner-glibc linkage (#381/#189) precisely,
  // without banning dynamic linkage itself.
  const paths = [
    { label: '_matrix.yml', file: '_matrix.yml', job: 'build', kind: 'npm' as Kind },
    { label: 'e2e-fixture-job.yml', file: 'e2e-fixture-job.yml', job: 'build', kind: 'npm' as Kind },
  ];

  function verifyStepOf(file: string, job: string): Step | undefined {
    const steps = loadSteps(file, job);
    return steps.find(
      (s) =>
        gatesOnBundleCliKind(s, 'npm') &&
        nameMatches(s, /verify/i) &&
        typeof s.run === 'string',
    );
  }

  it.each(paths)('$label: verify fails on a statically linked binary (cannot dlopen)', ({ file, job, label }) => {
    const step = verifyStepOf(file, job);
    expect(
      step,
      `${label}: could not find the \`bundle_cli — verify\` step. ` +
        'Expected a step gated on npm/bundled-cli whose name contains "verify" ' +
        'and whose run block checks the staged binary.',
    ).toBeDefined();
    const run = step!.run!;
    expect(
      run,
      `${label} bundle_cli — verify: the run block must treat a statically ` +
        'linked binary as the FAILURE case — a static (static-pie) binary has ' +
        'no dynamic loader, so consumer `dlopen` (SQLite extension loading) ' +
        'fails at runtime (#605, dirsql#762). Expected the shell block to grep ' +
        'for "statically linked" / "static-pie" and error, mentioning dlopen.',
    ).toMatch(/statically.linked|static.pie/i);
    expect(
      run,
      `${label} bundle_cli — verify: the static-linkage failure branch must say ` +
        'WHY static is fatal (dlopen), so the error is actionable (#605).',
    ).toMatch(/dlopen/i);
    expect(
      run,
      `${label} bundle_cli — verify: the old #384 direction (erroring on ` +
        '"dynamically linked") must be gone — post-#605 dynamic IS the ' +
        'required state.',
    ).not.toMatch(/expected statically-linked musl build/);
  });

  it.each(paths)('$label: verify enforces the GLIBC_FLOOR symbol ceiling', ({ file, job, label }) => {
    const step = verifyStepOf(file, job);
    expect(step, `${label}: \`bundle_cli — verify\` step not found`).toBeDefined();
    const run = step!.run!;
    expect(
      run,
      `${label} bundle_cli — verify: the run block must read the staged ` +
        "binary's versioned GLIBC_* symbol requirements (objdump -T) and fail " +
        'when the max exceeds the pinned GLIBC_FLOOR. This is the portability ' +
        'guard that replaces the #384 static assert: a binary accidentally ' +
        "linked against the runner's glibc (2.39) fails here instead of at a " +
        "consumer's runtime (#381/#189, #605).",
    ).toMatch(/objdump/);
    expect(
      run,
      `${label} bundle_cli — verify: the ceiling comparison must reference the ` +
        'GLIBC_ symbol version namespace (#605).',
    ).toMatch(/GLIBC_/);
    expect(
      `${JSON.stringify(step!.env ?? {})}\n${run}`,
      `${label} bundle_cli — verify: the enforced ceiling must be the same ` +
        'pinned 2.17 floor the build linked against (#605).',
    ).toMatch(/2\.17/);
  });
});

describe('npm bundle_cli: a consumer-declared `*-musl` target still builds and verifies (#605)', () => {
  // `targets` is free-form, and `npm-platform.ts`'s TRIPLE_MAP knows every
  // musl spelling (`linux-x64-musl`, `x86_64-unknown-linux-musl`,
  // `armv7-unknown-linux-musleabihf`, …), synthesizing `libc: ["musl"]` so
  // npm routes those sub-packages to musl distros only. Such a row is not the
  // #605 defect — the consumer asked for musl, and Alpine has no glibc to
  // dlopen against — but the #605 fix took two things away from it:
  //
  //   1. The `musl-tools` + `CC_<triple>=musl-gcc` step ran on EVERY Linux
  //      row. It was replaced by a zigbuild install that only the
  //      `*-linux-gnu*` cargo arm consumes, so a declared-musl row now has no
  //      C cross-compiler at all — every crate with C sources (the very ones
  //      a musl consumer is told to vendor: `libsqlite3-sys` bundled,
  //      vendored openssl, vendored libgit2) fails to link.
  //   2. The verify step's static-linkage assertion is unconditional on
  //      Linux, and musl output is static-pie by construction — so a
  //      declared-musl row that does compile is failed for being exactly what
  //      it was configured to be, under a dlopen rationale that cannot apply
  //      to it.
  //
  // The contract: musl rows go through `cargo zigbuild` too (zig ships musl,
  // so it *is* the C cross-compiler that replaced musl-tools) with no
  // glibc-floor suffix — musl has no glibc to floor — and the gnu-lane
  // linkage assertions are scoped to gnu triples.
  const paths = [
    { label: '_matrix.yml', file: '_matrix.yml', job: 'build' },
    { label: 'e2e-fixture-job.yml', file: 'e2e-fixture-job.yml', job: 'build' },
  ];

  it.each(paths)('$label: cargo build routes a declared musl triple through zigbuild', ({ file, job, label }) => {
    const steps = loadSteps(file, job);
    const step = findStep(steps, 'npm', /cargo build/i);
    expect(step, `${label}: \`bundle_cli — cargo build\` step not found`).toBeDefined();
    const run = step!.run!;

    const arm = declaredMuslArm(run);
    expect(
      arm,
      `${label} bundle_cli — cargo build: no branch handles a consumer-declared ` +
        '`*-linux-musl*` triple. #605 replaced the musl-tools/`CC_*=musl-gcc` ' +
        'step — which every Linux row used to get — with a zigbuild install, so ' +
        'a musl row that falls through to plain `cargo build` has no C ' +
        'cross-compiler and any crate with C sources fails to link (#605).',
    ).toBeDefined();

    expect(
      arm!,
      `${label} bundle_cli — cargo build: the declared-musl branch must build ` +
        'via `cargo zigbuild`. zig ships musl and is a C cross-compiler, so it ' +
        'is what replaces the musl-tools toolchain those rows lost (#605).',
    ).toMatch(/cargo\s+zigbuild/);

    expect(
      arm!,
      `${label} bundle_cli — cargo build: the declared-musl branch must NOT ` +
        'append the glibc floor to the target. `GLIBC_FLOOR` pins the glibc a ' +
        'gnu binary links against; a musl triple has no glibc, and ' +
        '`<triple>.2.17` is not a target zig accepts (#605).',
    ).not.toMatch(/GLIBC_FLOOR/);
  });

  it.each(paths)('$label: verify scopes the dlopen/glibc assertions to gnu triples', ({ file, job, label }) => {
    const steps = loadSteps(file, job);
    const step = steps.find(
      (s) => gatesOnBundleCliKind(s, 'npm') && nameMatches(s, /verify/i) && typeof s.run === 'string',
    );
    expect(step, `${label}: \`bundle_cli — verify\` step not found`).toBeDefined();

    expect(
      envBindsRustTarget(step!),
      `${label} bundle_cli — verify: the step must bind an env var to ` +
        '`${{ matrix.rust_target }}`. Without the triple it cannot tell a gnu ' +
        'row (where static linkage is the #605 defect) from a declared-musl row ' +
        '(where static-pie is the intended artifact), and fails both alike.',
    ).toBe(true);

    const arm = declaredMuslArm(step!.run!);
    expect(
      arm,
      `${label} bundle_cli — verify: no branch handles a consumer-declared ` +
        '`*-linux-musl*` triple, so the static-linkage check fires on it. musl ' +
        'output is static-pie by construction — the row would fail for doing ' +
        'exactly what it was configured to do, told it "cannot dlopen" when npm ' +
        'only ships it to musl distros in the first place (#605).',
    ).toBeDefined();

    expect(
      arm!,
      `${label} bundle_cli — verify: the declared-musl branch must not assert ` +
        'dynamic linkage — that is the gnu lane\'s contract (#605).',
    ).not.toMatch(/statically.linked|static.pie/i);

    expect(
      arm!,
      `${label} bundle_cli — verify: the declared-musl branch must not assert ` +
        'the GLIBC_* symbol ceiling — a musl binary carries no GLIBC_ symbols, ' +
        'so the check is vacuous there and its "dynamically linked" success line ' +
        'would be a false statement about the artifact (#605).',
    ).not.toMatch(/objdump/);
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
  // `matrix.target` for npm bundled-cli rows is an napi-rs short-form
  // triple (linux-x64-gnu, darwin-arm64, win32-x64-msvc, …) — NOT a Rust
  // triple. rustup / cargo only understand Rust triples, so the triple
  // must be mapped (linux-x64-gnu → x86_64-unknown-linux-gnu) before any
  // rustup / cargo invocation, otherwise:
  //
  //   error: toolchain 'stable-x86_64-unknown-linux-gnu' does not support
  //          target 'linux-x64-gnu'
  //
  // That mapping belongs in the engine, not in shell. `plan.ts` resolves
  // it once via `toRustTriple` and emits it on each bundled-cli row as
  // `rust_target`; the workflow consumes `${{ matrix.rust_target }}`
  // instead of re-deriving the correspondence inline. This keeps a single
  // source of truth (the engine's TRIPLE_MAP / NAPI_TO_RUST), is
  // unit-testable, and lets future musl-suffixed npm triples flow through
  // the same map. Previously each affected step carried its own copy of
  // the napi→rust `case` table — exactly the parallel reimplementation
  // #387 removes.
  //
  // The observable contract, per affected step:
  //   1. the step binds an env var to `${{ matrix.rust_target }}` (the
  //      engine-resolved Rust triple) and consumes that, and
  //   2. the run block carries NO inline napi→rust lookup — it contains
  //      no literal Rust-triple component (`unknown-linux`,
  //      `apple-darwin`, `pc-windows-msvc`). Those substrings appear only
  //      if a `case` / lookup table survived in the shell; the gnu→musl
  //      substitution `${RUST_TARGET//-linux-gnu/-linux-musl}` matches
  //      none of them.
  const npmPaths = [
    { label: '_matrix.yml npm bundled-cli', file: '_matrix.yml', job: 'build' },
    { label: 'e2e-fixture-job.yml npm bundled-cli', file: 'e2e-fixture-job.yml', job: 'build' },
  ];

  // A literal Rust-triple component, present only if an inline napi→rust
  // mapping survives in the shell.
  const inlineRustTriple = /unknown-linux|apple-darwin|pc-windows-msvc/;

  function envReferencesRustTarget(step: Step): boolean {
    return Object.values(step.env ?? {}).some((v) => /matrix\.rust_target/.test(v));
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

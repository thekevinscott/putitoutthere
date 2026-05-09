/**
 * Workflow YAML invariant checks. Catches the @v1-typo class of bug
 * (#243) without the trusted-publisher overhead of a live workflow
 * self-test (#244).
 *
 * Asserts:
 * - Every inner `uses: thekevinscott/putitoutthere*` ref pins `@v0`.
 * - Every external `uses:` ref pins a major (`@v4`, ...) or full SHA.
 * - Every `uses: ./...` local-path ref resolves to an existing file.
 * - The reusable workflow's path matches the README + CHANGELOG.
 *
 * Issue #246.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const workflowsDir = join(repoRoot, '.github/workflows');

interface UsesRef {
  workflow: string;
  line: number;
  ref: string;
}

function collectUses(): UsesRef[] {
  const out: UsesRef[] = [];
  for (const name of readdirSync(workflowsDir)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const text = readFileSync(join(workflowsDir, name), 'utf8');
    text.split('\n').forEach((raw, idx) => {
      if (raw.trimStart().startsWith('#')) return;
      const stripped = raw.replace(/\s+#.*$/, '');
      const m = stripped.match(/^\s*-?\s*uses:\s+['"]?([^'"\s]+)['"]?/);
      if (!m) return;
      out.push({ workflow: name, line: idx + 1, ref: m[1]! });
    });
  }
  return out;
}

const refs = collectUses();

describe('#246 workflow YAML invariants', () => {
  it('collects at least one uses ref (parser sanity)', () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it('every inner thekevinscott/putitoutthere ref pins @v0', () => {
    const inner = refs.filter((r) => r.ref.startsWith('thekevinscott/putitoutthere'));
    expect(inner.length).toBeGreaterThan(0);
    const bad = inner.filter(
      (r) => !/^thekevinscott\/putitoutthere(?:\/[^@]+)?@v0$/.test(r.ref),
    );
    expect(
      bad,
      `inner refs must pin @v0:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every external uses ref pins a major, full SHA, or vendor-recommended branch', () => {
    const external = refs.filter(
      (r) =>
        r.ref.includes('/') &&
        !r.ref.startsWith('./') &&
        !r.ref.startsWith('thekevinscott/putitoutthere'),
    );
    expect(external.length).toBeGreaterThan(0);
    const bad = external.filter((r) => {
      const at = r.ref.lastIndexOf('@');
      if (at <= 0) return true;
      const tag = r.ref.slice(at + 1);
      // Accept:
      //  - `vN`, `vN.M`, `vN.M.P` major-pinned tags
      //  - 40-char full SHA
      //  - `release/vN` — PyPA publishes `pypa/gh-action-pypi-publish` against
      //    a `release/vN` branch as their recommended pinning; specific tags
      //    miss security patches that PyPA back-applies to the branch. The
      //    branch is the upstream-blessed pin, even though it isn't a tag.
      return (
        !/^v\d+(?:\.\d+){0,2}$/.test(tag) &&
        !/^[0-9a-f]{40}$/.test(tag) &&
        !/^release\/v\d+$/.test(tag)
      );
    });
    expect(
      bad,
      `external refs must pin a major (@vN), full SHA, or release/vN branch:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every local-path uses ref resolves to a file in the repo', () => {
    const local = refs.filter((r) => r.ref.startsWith('./'));
    const bad = local.filter((r) => {
      const path = r.ref.split('@')[0]!;
      return !existsSync(join(repoRoot, path));
    });
    expect(
      bad,
      `local-path refs must point at an existing file:\n${bad.map((r) => `  ${r.workflow}:${r.line} ${r.ref}`).join('\n')}`,
    ).toEqual([]);
  });

  it('reusable workflow path matches README and CHANGELOG examples', () => {
    expect(existsSync(join(repoRoot, '.github/workflows/release.yml'))).toBe(true);
    const expected = 'thekevinscott/putitoutthere/.github/workflows/release.yml@v0';
    expect(readFileSync(join(repoRoot, 'README.md'), 'utf8')).toContain(expected);
    expect(readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')).toContain(expected);
  });

  // The publish step throws PIOT_PUBLISH_EMPTY_PLAN when reached with an
  // empty matrix; the gate is what keeps `release: skip` (and any other
  // empty-plan reason) from running publish to a non-zero exit. Lock the
  // gate's presence in so a future edit can't quietly delete it and turn
  // every skip-trailer commit into a red release run.
  //
  // The gate's `needs.<job>.outputs.matrix` reference depends on which
  // job exposes the matrix in the file under test:
  // - `release.yml` delegates plan + build to `_matrix.yml`; the publish
  //   job reads `needs.build.outputs.matrix` from the reusable-workflow
  //   caller.
  // - `release-npm.yml` keeps an inline plan job; the publish job reads
  //   `needs.plan.outputs.matrix`.
  it.each([
    [
      '.github/workflows/release.yml',
      "if: fromJSON(needs.build.outputs.matrix || '[]')[0] != null",
    ],
    [
      '.github/workflows/release-npm.yml',
      "if: fromJSON(needs.plan.outputs.matrix || '[]')[0] != null",
    ],
  ])('%s gates the publish job on a non-empty matrix', (path, gate) => {
    const text = readFileSync(join(repoRoot, path), 'utf8');
    expect(text).toContain(gate);
  });
});

// #283: the reusable workflow must accept a caller-provided
// `CARGO_REGISTRY_TOKEN` via `secrets:` and prefer it over OIDC when
// present. Trusted Publishing on crates.io is configured per-crate
// against an *already-published* crate, so the very first publish
// has no OIDC path available — without this fallback, every Rust
// consumer's first release through `putitoutthere` is blocked at
// `rust-lang/crates-io-auth-action@v1`. The contract this test pins:
//
//  1. `on.workflow_call.secrets.CARGO_REGISTRY_TOKEN` is declared and
//     optional (no `required: true`); callers without a token still
//     get the OIDC path unchanged.
//  2. The OIDC step (`rust-lang/crates-io-auth-action`) is skipped
//     when the secret is provided. Running both paths would clobber
//     the caller's token in `$GITHUB_ENV` with the OIDC-minted one.
//  3. A step exports the caller-provided secret to `$GITHUB_ENV` as
//     `CARGO_REGISTRY_TOKEN`, gated on the secret being non-empty,
//     so the engine's crates handler (which reads the env var) sees
//     it without caring which path produced it.
describe('#283 release.yml accepts caller-provided CARGO_REGISTRY_TOKEN', () => {
  interface Step {
    name?: string;
    if?: string;
    uses?: string;
    run?: string;
    env?: Record<string, string>;
  }
  interface ReleaseYaml {
    on?: {
      workflow_call?: {
        secrets?: Record<string, { required?: boolean; description?: string } | null>;
      };
    };
    jobs?: { publish?: { env?: Record<string, string>; steps?: Step[] } };
  }

  const releasePath = join(repoRoot, '.github/workflows/release.yml');
  const releaseText = readFileSync(releasePath, 'utf8');
  const release = parseYaml(releaseText) as ReleaseYaml;
  const publishJob = release.jobs?.publish;
  const publishSteps: Step[] = publishJob?.steps ?? [];

  it('declares CARGO_REGISTRY_TOKEN under workflow_call.secrets', () => {
    const secrets = release.on?.workflow_call?.secrets;
    expect(
      secrets,
      'workflow_call must declare a `secrets:` block (issue #283)',
    ).toBeDefined();
    expect(
      secrets,
      'workflow_call.secrets must declare CARGO_REGISTRY_TOKEN (issue #283)',
    ).toHaveProperty('CARGO_REGISTRY_TOKEN');
  });

  it('CARGO_REGISTRY_TOKEN is optional (callers without a token keep the OIDC path)', () => {
    const entry = release.on?.workflow_call?.secrets?.CARGO_REGISTRY_TOKEN;
    // YAML `SECRET:` (no value) parses to null; `SECRET: { required: false }`
    // is also acceptable. The thing that would break the contract is
    // `required: true`, which would force every caller — including
    // OIDC-only ones — to wire a token they don't have.
    if (entry && typeof entry === 'object') {
      expect(
        entry.required,
        'CARGO_REGISTRY_TOKEN must not be `required: true` (issue #283)',
      ).not.toBe(true);
    }
  });

  it('the publish job wires secrets.CARGO_REGISTRY_TOKEN into its env so step-level conditions can read it', () => {
    // GitHub Actions doesn't allow the `secrets` context inside
    // step-level `if:` (only `env`, `inputs`, `needs`, etc — see
    // https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability).
    // The workflow therefore has to promote the optional caller-provided
    // secret to the job's env block; the step `if:` then reads through
    // that env var. Pin the wiring so a future edit can't drop the
    // promotion and silently break the gate (the OIDC step would then
    // run unconditionally and clobber any caller token in $GITHUB_ENV).
    const env = publishJob?.env ?? {};
    const wired = Object.values(env).filter(
      (v) => typeof v === 'string' && v.includes('secrets.CARGO_REGISTRY_TOKEN'),
    );
    expect(
      wired.length,
      'publish job must expose secrets.CARGO_REGISTRY_TOKEN via its `env:` block (issue #283)',
    ).toBeGreaterThan(0);
  });

  it('the crates-io-auth-action step is skipped when the caller supplied a token', () => {
    const oidcStep = publishSteps.find(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('rust-lang/crates-io-auth-action'),
    );
    expect(
      oidcStep,
      'expected a `rust-lang/crates-io-auth-action` step in the publish job',
    ).toBeDefined();
    expect(
      oidcStep?.if,
      'the OIDC step must be conditional (issue #283)',
    ).toBeDefined();
    // The gate must reference CARGO_REGISTRY_TOKEN — either the secret
    // name directly (where allowed) or the env var the workflow defines
    // to expose it. We don't pin exact expression syntax beyond that.
    expect(
      oidcStep?.if ?? '',
      "the OIDC step's `if:` must reference CARGO_REGISTRY_TOKEN (directly or via the env-var promotion) (issue #283)",
    ).toMatch(/CARGO_REGISTRY_TOKEN/);
  });

  it('a step exports the caller-provided secret to GITHUB_ENV as CARGO_REGISTRY_TOKEN', () => {
    // Look for a `run:` step that writes CARGO_REGISTRY_TOKEN to
    // $GITHUB_ENV, sourcing it from secrets.CARGO_REGISTRY_TOKEN —
    // either inlined as ${{ secrets.X }} in the step's env: / run:,
    // or via the job-level env-var promotion (env.CALLER_X-style),
    // since step-level `if:` can't reference `secrets` directly.
    // The OIDC export step (which sources from
    // `steps.crates-auth.outputs.token`) does not satisfy this
    // contract — it can't run when the OIDC step itself was skipped.
    const jobEnvKeys = Object.entries(publishJob?.env ?? [])
      .filter(([, v]) => typeof v === 'string' && v.includes('secrets.CARGO_REGISTRY_TOKEN'))
      .map(([k]) => k);
    const exportSteps = publishSteps.filter((s) => {
      if (typeof s.run !== 'string') return false;
      if (!s.run.includes('CARGO_REGISTRY_TOKEN') || !s.run.includes('GITHUB_ENV')) return false;
      const envBlock = s.env ?? {};
      const inlinedFromSecret = Object.values(envBlock).some(
        (v) => typeof v === 'string' && v.includes('secrets.CARGO_REGISTRY_TOKEN'),
      );
      const directlyFromSecret = s.run.includes('secrets.CARGO_REGISTRY_TOKEN');
      const fromJobEnv = jobEnvKeys.some((k) => s.run!.includes(`$${k}`) || s.run!.includes(`\${${k}}`));
      return inlinedFromSecret || directlyFromSecret || fromJobEnv;
    });
    expect(
      exportSteps,
      'expected a publish-job step that exports the caller-provided crates.io token to $GITHUB_ENV (issue #283)',
    ).not.toEqual([]);
    const step = exportSteps[0]!;
    expect(
      step.if ?? '',
      "the token-export step must gate on CARGO_REGISTRY_TOKEN being non-empty (issue #283)",
    ).toMatch(/CARGO_REGISTRY_TOKEN/);
  });

  // The secret *name* is part of the workflow's public API: a consumer
  // copy-pasting from the README has to spell it exactly to wire the
  // fallback. Lock the documented name to the workflow-declared name
  // so a future rename can't slip through with the docs left stale —
  // mirrors the `reusable workflow path matches README` invariant
  // above. See AGENTS.md > "Where to put what" — README is the single
  // user-facing surface.
  it('CARGO_REGISTRY_TOKEN secret name is documented in README', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    expect(
      readme,
      'README must mention CARGO_REGISTRY_TOKEN by name so consumers can wire the secret (issue #283)',
    ).toMatch(/CARGO_REGISTRY_TOKEN/);
  });
});

// #276: every PyO3/maturin-action invocation in `_matrix.yml`'s build job
// must be preceded by a step that bumps the package's version source to
// `${{ matrix.version }}`. Without this, maturin reads whatever literal
// is on disk in pyproject.toml and ships wheels at the stale version
// — the registered package fails to upload because PyPI rejects
// duplicate filenames.
//
// Other build paths bump elsewhere:
//  - crates: writeVersion runs at publish.
//  - npm:    writeVersion runs at publish.
//  - pypi (setuptools-scm/hatch-vcs): SETUPTOOLS_SCM_PRETEND_VERSION env.
// Maturin is the only build path where the artifact (wheel) leaves the
// build runner pre-versioned, so the bump must happen here, before the
// maturin call. See #276.
describe('#276 _matrix.yml maturin pre-build version bump', () => {
  interface Step {
    if?: string;
    uses?: string;
    with?: Record<string, unknown>;
  }
  interface MatrixYaml {
    jobs?: { build?: { steps?: Step[] } };
  }

  const matrixPath = join(repoRoot, '.github/workflows/_matrix.yml');
  const matrix = parseYaml(readFileSync(matrixPath, 'utf8')) as MatrixYaml;
  const buildSteps: Step[] = matrix.jobs?.build?.steps ?? [];

  function isMaturinStep(step: Step): boolean {
    return typeof step.uses === 'string' && step.uses.startsWith('PyO3/maturin-action');
  }

  function isVersionBumpStep(step: Step): boolean {
    if (!step.with) return false;
    const w = step.with as Record<string, unknown>;
    if (w.command !== 'write-version') return false;
    const version = typeof w.version === 'string' ? w.version : '';
    return version.includes('matrix.version');
  }

  it('build job has at least one maturin step (parser sanity)', () => {
    const maturinSteps = buildSteps.filter(isMaturinStep);
    expect(maturinSteps.length).toBeGreaterThan(0);
  });

  it('every maturin invocation is preceded by a write-version step gated on the same matrix conditions', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isMaturinStep(step)) return;
      const earlier = buildSteps.slice(0, idx);
      const matchingBump = earlier.find(
        (s) =>
          isVersionBumpStep(s) &&
          // The bump step must gate on matrix.kind == 'pypi' AND
          // matrix.build == 'maturin' so it doesn't run for non-maturin
          // pypi rows (where SETUPTOOLS_SCM_PRETEND_VERSION already
          // handles the bump) or for any non-pypi row.
          typeof s.if === 'string' &&
          s.if.includes("matrix.kind == 'pypi'") &&
          s.if.includes("matrix.build == 'maturin'"),
      );
      if (!matchingBump) {
        offenders.push(
          `step #${idx} (uses=${step.uses}, if=${step.if ?? '(none)'}) has no preceding write-version bump step`,
        );
      }
    });
    expect(
      offenders,
      `every maturin step must be preceded by a write-version bump:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// #282: `[package.bundle_cli]` is parsed by config, attached to per-target
// wheel rows by the planner, and documented in the README — but
// `_matrix.yml` never consumes it. Wheels for maturin packages that
// declare `bundle_cli` ship without the bundled binary, and the
// consumer's `pip install` flow fails at runtime.
//
// MIGRATIONS.md (#217) promised two scaffolded build steps gated on
// `matrix.kind == 'pypi' && matrix.bundle_cli.bin != '' && matrix.target != 'sdist'`:
//   - Setup Rust + cross-compile the binary for matrix.target
//   - Stage the resulting binary into ${{ matrix.path }}/${{ matrix.bundle_cli.stage_to }}/
// Plus a permanent post-build guard: the maturin-produced wheel must
// contain the staged binary, or upload-artifact is refused. The guard
// is independent of staging — it catches any future regression where
// the cross-compile silently writes to the wrong path, and it stays
// useful even after the staging step lands.
describe('#282 _matrix.yml bundle_cli staging + wheel-content guard', () => {
  interface Step {
    if?: string;
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
  }
  interface MatrixYaml {
    jobs?: { build?: { steps?: Step[] } };
  }

  const matrixPath = join(repoRoot, '.github/workflows/_matrix.yml');
  const matrix = parseYaml(readFileSync(matrixPath, 'utf8')) as MatrixYaml;
  const buildSteps: Step[] = matrix.jobs?.build?.steps ?? [];

  function isMaturinWheelStep(step: Step): boolean {
    if (typeof step.uses !== 'string' || !step.uses.startsWith('PyO3/maturin-action')) return false;
    // Per-target wheel build (not sdist).
    return typeof step.if === 'string'
      && step.if.includes("matrix.build == 'maturin'")
      && step.if.includes("matrix.target != 'sdist'");
  }

  function gatesOnBundleCli(condition: string | undefined): boolean {
    if (typeof condition !== 'string') return false;
    return condition.includes('matrix.bundle_cli');
  }

  function isCargoBuildStep(step: Step): boolean {
    if (!gatesOnBundleCli(step.if)) return false;
    const text = [
      step.run ?? '',
      JSON.stringify(step.with ?? {}),
    ].join('\n');
    return text.includes('cargo build')
      && text.includes('matrix.target')
      && text.includes('matrix.bundle_cli.bin');
  }

  function isStageStep(step: Step): boolean {
    if (!gatesOnBundleCli(step.if)) return false;
    const run = step.run ?? '';
    return run.includes('matrix.bundle_cli.stage_to')
      && run.includes('matrix.bundle_cli.bin')
      && run.includes('matrix.path');
  }

  function isWheelGuardStep(step: Step): boolean {
    if (!gatesOnBundleCli(step.if)) return false;
    const run = step.run ?? '';
    // The guard opens the wheel and asserts it contains the staged
    // binary at <stage_to>/<bin>. unzip -l is the lightweight check;
    // a CLI subcommand would also satisfy this contract.
    const looksLikeWheelInspection = run.includes('.whl')
      && (run.includes('unzip') || run.includes('verify-bundle-cli'));
    const referencesBin = run.includes('matrix.bundle_cli.bin')
      && run.includes('matrix.bundle_cli.stage_to');
    return looksLikeWheelInspection && referencesBin;
  }

  it('build job has at least one maturin per-target wheel step (parser sanity)', () => {
    expect(buildSteps.filter(isMaturinWheelStep).length).toBeGreaterThan(0);
  });

  it('every maturin per-target wheel step is preceded by a bundle_cli cargo-build step', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isMaturinWheelStep(step)) return;
      const earlier = buildSteps.slice(0, idx);
      if (!earlier.some(isCargoBuildStep)) {
        offenders.push(
          `step #${idx} (uses=${step.uses}, if=${step.if ?? '(none)'}) has no preceding bundle_cli cargo-build step`,
        );
      }
    });
    expect(
      offenders,
      `each maturin wheel build needs a preceding step gated on matrix.bundle_cli that runs \`cargo build --release --target \${{ matrix.target }} --bin \${{ matrix.bundle_cli.bin }}\`:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every maturin per-target wheel step is preceded by a bundle_cli stage step', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isMaturinWheelStep(step)) return;
      const earlier = buildSteps.slice(0, idx);
      if (!earlier.some(isStageStep)) {
        offenders.push(
          `step #${idx} (uses=${step.uses}, if=${step.if ?? '(none)'}) has no preceding bundle_cli stage step`,
        );
      }
    });
    expect(
      offenders,
      `each maturin wheel build needs a preceding step gated on matrix.bundle_cli that copies the cross-compiled binary into \${{ matrix.path }}/\${{ matrix.bundle_cli.stage_to }}/:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every maturin per-target wheel step is followed by a wheel-content guard', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isMaturinWheelStep(step)) return;
      const later = buildSteps.slice(idx + 1);
      if (!later.some(isWheelGuardStep)) {
        offenders.push(
          `step #${idx} (uses=${step.uses}, if=${step.if ?? '(none)'}) has no following wheel-content guard`,
        );
      }
    });
    expect(
      offenders,
      `each maturin wheel build needs a following step gated on matrix.bundle_cli that opens the produced .whl and asserts it contains \${{ matrix.bundle_cli.stage_to }}/\${{ matrix.bundle_cli.bin }}:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

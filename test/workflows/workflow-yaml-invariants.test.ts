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

// #302: mirror of #283 for npm. Trusted Publishing on npm binds to an
// *already-published* package, so the very first publish of a brand-new
// package has no OIDC path available — consumers were forced to hand-publish
// `0.0.0-bootstrap` stubs of every per-platform sub-package with a
// long-lived NODE_AUTH_TOKEN before they could register Trusted Publishers
// and use this workflow. Hit in the wild on the maintainer's own dirsql
// project (`@dirsql/cli-linux-x64-gnu` first version on npm is
// `0.0.0-bootstrap`, 2026-04-30; real `0.2.8` lands the next day) and on
// `darkfactory`'s first publish. The contract this test pins:
//
//  1. `on.workflow_call.secrets.NPM_TOKEN` is declared and optional
//     (no `required: true`); callers without a token still get the
//     OIDC path unchanged.
//  2. The publish job promotes `secrets.NPM_TOKEN` to a job-level
//     env var so step-level `if:` conditions can gate on it (the
//     `secrets` context isn't available in step-level `if:`).
//  3. A step exports the caller-provided secret to `$GITHUB_ENV` as
//     `NODE_AUTH_TOKEN`, gated on the secret being non-empty and the
//     planned matrix containing at least one `kind = "npm"` row, so
//     the engine's npm handler (and the npm CLI itself) sees it
//     instead of attempting OIDC.
//
// Mirror of #283 in shape, byte-for-byte. The npm side has no separate
// OIDC step to "skip" (npm CLI handles OIDC internally via the runner's
// id-token); presence of NODE_AUTH_TOKEN in the env makes the CLI prefer
// the long-lived token over the OIDC path.
describe('#302 release.yml accepts caller-provided NPM_TOKEN', () => {
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

  it('declares NPM_TOKEN under workflow_call.secrets', () => {
    const secrets = release.on?.workflow_call?.secrets;
    expect(
      secrets,
      'workflow_call must declare a `secrets:` block (issue #302)',
    ).toBeDefined();
    expect(
      secrets,
      'workflow_call.secrets must declare NPM_TOKEN (issue #302)',
    ).toHaveProperty('NPM_TOKEN');
  });

  it('NPM_TOKEN is optional (callers without a token keep the OIDC path)', () => {
    const entry = release.on?.workflow_call?.secrets?.NPM_TOKEN;
    // YAML `SECRET:` (no value) parses to null; `SECRET: { required: false }`
    // is also acceptable. `required: true` would force every caller —
    // including OIDC-only ones — to wire a token they don't have.
    if (entry && typeof entry === 'object') {
      expect(
        entry.required,
        'NPM_TOKEN must not be `required: true` (issue #302)',
      ).not.toBe(true);
    }
  });

  it('the publish job wires secrets.NPM_TOKEN into its env so step-level conditions can read it', () => {
    // GitHub Actions doesn't allow the `secrets` context inside
    // step-level `if:` (only `env`, `inputs`, `needs`, etc — see
    // https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability).
    // The workflow therefore has to promote the optional caller-provided
    // secret to the job's env block; the step `if:` then reads through
    // that env var. Pin the wiring so a future edit can't drop the
    // promotion and silently break the gate. Mirrors the #283 invariant.
    const env = publishJob?.env ?? {};
    const wired = Object.values(env).filter(
      (v) => typeof v === 'string' && v.includes('secrets.NPM_TOKEN'),
    );
    expect(
      wired.length,
      'publish job must expose secrets.NPM_TOKEN via its `env:` block (issue #302)',
    ).toBeGreaterThan(0);
  });

  it('a step exports the caller-provided secret to GITHUB_ENV as NODE_AUTH_TOKEN', () => {
    // Look for a `run:` step that writes NODE_AUTH_TOKEN to $GITHUB_ENV,
    // sourcing it from secrets.NPM_TOKEN — either inlined as
    // ${{ secrets.X }} in the step's env: / run:, or via the job-level
    // env-var promotion (env.CALLER_X-style), since step-level `if:`
    // can't reference `secrets` directly.
    const jobEnvKeys = Object.entries(publishJob?.env ?? [])
      .filter(([, v]) => typeof v === 'string' && v.includes('secrets.NPM_TOKEN'))
      .map(([k]) => k);
    const exportSteps = publishSteps.filter((s) => {
      if (typeof s.run !== 'string') return false;
      if (!s.run.includes('NODE_AUTH_TOKEN') || !s.run.includes('GITHUB_ENV')) return false;
      const envBlock = s.env ?? {};
      const inlinedFromSecret = Object.values(envBlock).some(
        (v) => typeof v === 'string' && v.includes('secrets.NPM_TOKEN'),
      );
      const directlyFromSecret = s.run.includes('secrets.NPM_TOKEN');
      const fromJobEnv = jobEnvKeys.some(
        (k) => s.run!.includes(`$${k}`) || s.run!.includes(`\${${k}}`),
      );
      return inlinedFromSecret || directlyFromSecret || fromJobEnv;
    });
    expect(
      exportSteps,
      'expected a publish-job step that exports the caller-provided npm token to $GITHUB_ENV as NODE_AUTH_TOKEN (issue #302)',
    ).not.toEqual([]);
    const step = exportSteps[0]!;
    // The export must gate on the secret being non-empty AND the matrix
    // containing at least one npm row. Without the matrix gate, every
    // crates/pypi-only release run would still export a NODE_AUTH_TOKEN
    // the run never uses; with it, the step is a no-op for non-npm repos
    // exactly like the OIDC path is.
    expect(
      step.if ?? '',
      "the token-export step must gate on NPM_TOKEN being non-empty (issue #302)",
    ).toMatch(/NPM_TOKEN/);
    expect(
      step.if ?? '',
      "the token-export step must gate on the planned matrix containing an npm row (issue #302)",
    ).toMatch(/"kind":"npm"|kind == 'npm'/);
  });

  // The secret *name* is part of the workflow's public API: a consumer
  // copy-pasting from the README has to spell it exactly to wire the
  // fallback. Mirrors the #283 invariant.
  it('NPM_TOKEN secret name is documented in README', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    expect(
      readme,
      'README must mention NPM_TOKEN by name so consumers can wire the secret (issue #302)',
    ).toMatch(/NPM_TOKEN/);
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
    env?: Record<string, unknown>;
    'working-directory'?: string;
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

  // Concatenate every place a matrix expression can legitimately appear
  // on a step (run script, with: action inputs, env: vars, working-
  // directory). Lets the assertions below check "this step references
  // bundle_cli.bin somewhere" without dictating which subkey — env-var
  // pattern (matrix expressions in `env:`, used by `$VAR` in run script)
  // is the established style in `e2e-fixture-job.yml:198-238`.
  function stepText(step: Step): string {
    return [
      step.run ?? '',
      step['working-directory'] ?? '',
      JSON.stringify(step.with ?? {}),
      JSON.stringify(step.env ?? {}),
    ].join('\n');
  }

  function isCargoBuildStep(step: Step): boolean {
    if (!gatesOnBundleCli(step.if)) return false;
    const text = stepText(step);
    return text.includes('cargo build')
      && text.includes('matrix.target')
      && text.includes('matrix.bundle_cli.bin');
  }

  function isStageStep(step: Step): boolean {
    if (!gatesOnBundleCli(step.if)) return false;
    const text = stepText(step);
    return text.includes('matrix.bundle_cli.stage_to')
      && text.includes('matrix.bundle_cli.bin')
      && text.includes('matrix.path');
  }

  function isWheelGuardStep(step: Step): boolean {
    if (!gatesOnBundleCli(step.if)) return false;
    const run = step.run ?? '';
    const text = stepText(step);
    // The guard opens the wheel and asserts it contains the staged
    // binary at <stage_to>/<bin>. unzip -l is the lightweight check;
    // a CLI subcommand would also satisfy this contract.
    const looksLikeWheelInspection = run.includes('.whl')
      && (run.includes('unzip') || run.includes('verify-bundle-cli'));
    const referencesBin = text.includes('matrix.bundle_cli.bin')
      && text.includes('matrix.bundle_cli.stage_to');
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

  // #338: the wheel-content guard's regex asserts a literal
  // `<stage_to>/<bin>` suffix inside the produced wheel — but maturin
  // strips `[tool.maturin].python-source` from on-disk paths when it
  // rewrites them into the wheel's distribution layout. For consumers
  // with `python-source = "python"` (the layout `maturin new --mixed`
  // generates), the binary on disk lives at
  // `<pkg.path>/<stage_to>/<bin>` = `packages/python/python/dirsql/_binary/dirsql`
  // but in the wheel ends up at `dirsql/_binary/dirsql` — `python/`
  // stripped. The guard's regex `(^|/)python/dirsql/_binary/dirsql$`
  // never matches, so the guard fires red on every per-target build
  // row even though the binary is correctly bundled.
  //
  // The guard step must read the consumer's pyproject and subtract the
  // `[tool.maturin].python-source` prefix from `stage_to` before
  // constructing the regex. When unset/empty the behaviour is
  // identical to today.
  it('wheel-content guard accounts for [tool.maturin].python-source path stripping', () => {
    const guardSteps = buildSteps.filter(isWheelGuardStep);
    expect(guardSteps.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    guardSteps.forEach((step, idx) => {
      const text = stepText(step);
      // Either form of the key is acceptable — TOML allows both
      // `python-source` and `python_source` and maturin honors both
      // across versions. The guard either parses the consumer's
      // pyproject (look for the substring) or delegates to a CLI
      // subcommand whose name implies the same responsibility.
      const readsPyprojectKey = text.includes('python-source')
        || text.includes('python_source');
      const delegatesToVerifierCli = text.includes('verify-bundle-cli')
        || text.includes('verify-wheel');
      if (!readsPyprojectKey && !delegatesToVerifierCli) {
        offenders.push(
          `wheel-content guard step #${idx} neither reads [tool.maturin].python-source from the consumer's pyproject nor delegates to a CLI subcommand that owns the stripping responsibility`,
        );
      }
    });
    expect(
      offenders,
      `the wheel-content guard must subtract [tool.maturin].python-source from stage_to before asserting the in-wheel path, otherwise it fails red for every consumer that uses the standard mixed-project layout (maturin new --mixed). See https://github.com/thekevinscott/putitoutthere/issues/338.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// #298: mirror of #282 for npm. `[package.bundle_cli]` should be parsed
// by config and attached to per-target npm bundled-cli rows by the
// planner, then consumed by `_matrix.yml` — same shape as the maturin
// wiring landed in #282. Without this, npm bundled-cli consumers are
// still required to author `scripts/build.cjs` that performs the
// cross-compile (rustup target add / cargo build / cp into
// build/<triple>/<bin>); every consumer of this recipe to date has
// written essentially the same script, and every one has hit bugs at
// the seam between their script and the engine (#287 was the most
// recent). Absorbing the script into the workflow closes the largest
// remaining piece of consumer integration surface that exists for no
// architectural reason.
//
// Expected wiring, for every per-target row with
// `matrix.kind == 'npm' && matrix.build == 'bundled-cli' &&
//  matrix.bundle_cli && matrix.target != 'main'`:
//   - `rustup target add ${{ matrix.target }}`
//   - `cargo build --release --target ${{ matrix.target }} --bin ${{ matrix.bundle_cli.bin }}`
//     against `crate_path`
//   - copy binary (with `.exe` on Windows) to
//     `${{ matrix.artifact_path }}/${{ matrix.bundle_cli.bin }}`
//     (which is `${{ matrix.path }}/build/<triple>` for single-mode rows
//     and `${{ matrix.path }}/build/<mode>-<triple>` for multi-mode rows;
//     plan.ts already encodes the right directory in `artifact_path`)
//   - defense-in-depth: assert the staged binary exists before
//     `actions/upload-artifact` runs, so a broken row never leaves the
//     build runner
//
// The post-build guard mirrors the wheel-content guard in #282: it
// stays useful after the staging step lands, catching any future
// regression where the cross-compile silently routes the binary to
// the wrong path.
describe('#298 _matrix.yml npm bundle_cli staging + build-content guard', () => {
  interface Step {
    if?: string;
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, unknown>;
    'working-directory'?: string;
  }
  interface MatrixYaml {
    jobs?: { build?: { steps?: Step[] } };
  }

  const matrixPath = join(repoRoot, '.github/workflows/_matrix.yml');
  const matrix = parseYaml(readFileSync(matrixPath, 'utf8')) as MatrixYaml;
  const buildSteps: Step[] = matrix.jobs?.build?.steps ?? [];

  // The npm consumer-build step in `_matrix.yml` is the single
  // consolidated `if: matrix.kind == 'npm'` step that runs
  // `npm install` + `npm run build --if-present`. Bundle_cli staging
  // must FOLLOW it (#384) so the engine's musl binary always overwrites
  // any glibc-linked binary a consumer build script stages to the same
  // `build/<triple>/` path during `npm run build`.
  function isNpmConsumerBuildStep(step: Step): boolean {
    if (typeof step.if !== 'string') return false;
    if (!step.if.includes("matrix.kind == 'npm'")) return false;
    const run = step.run ?? '';
    return run.includes('npm run build');
  }

  function gatesOnNpmBundleCli(condition: string | undefined): boolean {
    if (typeof condition !== 'string') return false;
    return (
      condition.includes('matrix.bundle_cli') &&
      condition.includes("matrix.kind == 'npm'") &&
      condition.includes("matrix.build == 'bundled-cli'") &&
      // 'main' is the noarch top-level row; it has no per-target
      // binary to cross-compile.
      condition.includes("matrix.target != 'main'")
    );
  }

  // Concatenate every place a matrix expression can legitimately appear
  // on a step (run script, with: action inputs, env: vars, working-
  // directory). Lets the assertions below check "this step references
  // bundle_cli.bin somewhere" without dictating which subkey — env-var
  // pattern (matrix expressions in `env:`, used by `$VAR` in run script)
  // is the established style in `_matrix.yml` bundle_cli pypi steps.
  function stepText(step: Step): string {
    return [
      step.run ?? '',
      step['working-directory'] ?? '',
      JSON.stringify(step.with ?? {}),
      JSON.stringify(step.env ?? {}),
    ].join('\n');
  }

  function isCargoBuildStep(step: Step): boolean {
    if (!gatesOnNpmBundleCli(step.if)) return false;
    const text = stepText(step);
    return text.includes('cargo build')
      && text.includes('matrix.target')
      && text.includes('matrix.bundle_cli.bin');
  }

  function isStageStep(step: Step): boolean {
    if (!gatesOnNpmBundleCli(step.if)) return false;
    if (isCargoBuildStep(step)) return false;
    const text = stepText(step);
    // The stage step copies the cross-compiled binary into the
    // directory plan.ts encoded in matrix.artifact_path. We accept
    // either `matrix.artifact_path` directly or the equivalent
    // composed path (matrix.path + the per-target subdir), but the
    // step must reference both the bin name and the destination
    // sufficient to identify it as the stage step.
    const referencesBin = text.includes('matrix.bundle_cli.bin');
    const referencesDest =
      text.includes('matrix.artifact_path') ||
      (text.includes('matrix.path') && text.includes('matrix.target'));
    return referencesBin && referencesDest;
  }

  function isUploadArtifactStep(step: Step): boolean {
    return typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact');
  }

  function isBuildGuardStep(step: Step): boolean {
    if (!gatesOnNpmBundleCli(step.if)) return false;
    const run = step.run ?? '';
    const text = stepText(step);
    // The guard asserts the staged binary exists at the expected
    // path before upload-artifact runs. `test -f`, `[ -f ... ]`, or
    // a CLI subcommand all satisfy this contract; what matters is
    // that the step references the bin and fails if it's missing.
    const looksLikeFsCheck =
      run.includes('test -f') ||
      run.includes('[ -f') ||
      run.includes('verify-bundle-cli');
    const referencesBin = text.includes('matrix.bundle_cli.bin');
    return looksLikeFsCheck && referencesBin;
  }

  it('build job has at least one npm consumer-build step (parser sanity)', () => {
    expect(buildSteps.filter(isNpmConsumerBuildStep).length).toBeGreaterThan(0);
  });

  it('every npm consumer-build step is preceded by a bundle_cli cargo-build step', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isNpmConsumerBuildStep(step)) return;
      const earlier = buildSteps.slice(0, idx);
      if (!earlier.some(isCargoBuildStep)) {
        offenders.push(
          `step #${idx} (if=${step.if ?? '(none)'}) has no preceding bundle_cli cargo-build step`,
        );
      }
    });
    expect(
      offenders,
      `each npm consumer-build step needs a preceding step gated on \`matrix.kind == 'npm' && matrix.build == 'bundled-cli' && matrix.bundle_cli && matrix.target != 'main'\` that runs \`cargo build --release --target \${{ matrix.target }} --bin \${{ matrix.bundle_cli.bin }}\`:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every npm consumer-build step is followed by a bundle_cli stage step', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isNpmConsumerBuildStep(step)) return;
      const later = buildSteps.slice(idx + 1);
      if (!later.some(isStageStep)) {
        offenders.push(
          `step #${idx} (if=${step.if ?? '(none)'}) has no following bundle_cli stage step`,
        );
      }
    });
    expect(
      offenders,
      `each npm consumer-build step needs a following step gated on the same condition that copies the cross-compiled binary into \${{ matrix.artifact_path }}/ so the engine's musl binary overwrites any glibc binary the consumer build script staged (#384):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('every upload-artifact step is preceded by a bundle_cli build-content guard', () => {
    const offenders: string[] = [];
    buildSteps.forEach((step, idx) => {
      if (!isUploadArtifactStep(step)) return;
      const earlier = buildSteps.slice(0, idx);
      if (!earlier.some(isBuildGuardStep)) {
        offenders.push(
          `upload-artifact step #${idx} (if=${step.if ?? '(none)'}) has no preceding bundle_cli build-content guard`,
        );
      }
    });
    expect(
      offenders,
      `upload-artifact must be preceded by a step gated on the same npm bundle_cli condition that asserts the staged binary exists at \${{ matrix.artifact_path }}/\${{ matrix.bundle_cli.bin }} (defense-in-depth — catches a future regression where the cross-compile routes the binary to the wrong path):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// #317: pre-merge `check.yml` reusable workflow. Pins the file's shape
// so it stays consumable in one line by a downstream PR-CI workflow:
//
//   jobs:
//     putitoutthere-check:
//       uses: thekevinscott/putitoutthere/.github/workflows/check.yml@v0
//
// Acceptance from the issue:
//   - the file exists,
//   - it is a reusable workflow (`on: workflow_call`),
//   - it drives the engine through the same JS action `release.yml`
//     uses (no new step-level action shape — non-goal #10 from #316's
//     reframe), with `command: check`,
//   - the README documents it the same way `release.yml` is documented.
//
// What's deliberately NOT pinned here: the set of checks the workflow
// runs. Those are #319's contract and get their own integration tests.
// This test guards the shell only.
describe('#317 check.yml reusable workflow shape', () => {
  interface Step {
    name?: string;
    uses?: string;
    with?: Record<string, unknown>;
  }
  interface CheckYaml {
    on?: {
      workflow_call?: {
        inputs?: Record<string, unknown>;
      };
    };
    permissions?: Record<string, string>;
    jobs?: Record<string, { steps?: Step[]; uses?: string; with?: Record<string, unknown>; permissions?: Record<string, string> }>;
  }

  const checkPath = join(repoRoot, '.github/workflows/check.yml');

  it('the file exists at .github/workflows/check.yml', () => {
    expect(
      existsSync(checkPath),
      'check.yml must exist (issue #317 acceptance)',
    ).toBe(true);
  });

  it('declares `on: workflow_call` so consumers can call it via `uses:`', () => {
    const parsed = parseYaml(readFileSync(checkPath, 'utf8')) as CheckYaml;
    expect(
      parsed.on?.workflow_call,
      'check.yml must be a reusable workflow (on: workflow_call) — issue #317',
    ).toBeDefined();
  });

  it('runs the engine via the JS action with `command: check`', () => {
    // The issue forbids forking validation logic across two surfaces.
    // The release.yml path drives the engine via
    // `uses: thekevinscott/putitoutthere@v0` with `command: <name>`;
    // check.yml must do the same so both surfaces invoke the same
    // CLI entry point and share the same validation code path.
    const parsed = parseYaml(readFileSync(checkPath, 'utf8')) as CheckYaml;
    const jobs = parsed.jobs ?? {};
    const allSteps: Step[] = [];
    for (const job of Object.values(jobs)) {
      for (const step of job?.steps ?? []) allSteps.push(step);
    }
    const engineStep = allSteps.find(
      (s) =>
        typeof s.uses === 'string' &&
        /^thekevinscott\/putitoutthere(?:\/[^@]+)?@v0$/.test(s.uses) &&
        // The top-level repo ref is the JS action wrapper; the
        // path-suffixed refs are the other reusable workflows
        // (release.yml, build.yml, _matrix.yml). The action is the
        // one that takes a `command:` input.
        !s.uses.includes('/.github/workflows/'),
    );
    expect(
      engineStep,
      'check.yml must invoke `uses: thekevinscott/putitoutthere@v0` to drive the engine (issue #317)',
    ).toBeDefined();
    expect(
      engineStep?.with?.command,
      'the JS-action step must pass `command: check` so the same engine entry point as plan/publish/write-version runs (issue #317)',
    ).toBe('check');
  });

  it('requests minimal permissions (no `id-token: write`)', () => {
    // Mirror of build.yml's structural guarantee: a PR-time surface
    // must not carry the OIDC publish capability. A configuration
    // check that can mint a registry token is a parallel diagnostic
    // surface masquerading as a check (non-goal #8 again). Strip
    // YAML comments before matching so the header documentation
    // (which legitimately names the forbidden permission to explain
    // why it isn't there) doesn't trip the regex.
    const text = readFileSync(checkPath, 'utf8')
      .split('\n')
      .map((line) => line.replace(/(^|[^"'])#.*$/, '$1'))
      .join('\n');
    expect(
      text,
      'check.yml must not request id-token: write — PR-time surface cannot mint publish tokens (issue #317)',
    ).not.toMatch(/id-token:\s*write/);
  });

  it('README documents the check.yml integration line', () => {
    // The reusable workflow path is consumer-facing: a copy-paste
    // from the README is the integration surface, so a drift between
    // the file's actual path and the documented path breaks every
    // adopter silently. Mirror of the release.yml invariant above.
    const expected = 'thekevinscott/putitoutthere/.github/workflows/check.yml@v0';
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    expect(
      readme,
      'README must document the check.yml integration line so consumers can wire it in one line (issue #317 acceptance)',
    ).toContain(expected);
  });
});

// Post-publish tarball-verify step (#304) retries `npm view` to handle
// npm packument-metadata propagation lag across CDN edges, but until
// this fix the `curl` that fetched the tarball blob itself had no
// retry. npm's packument index and tarball blobs propagate
// independently — `npm view` can mint a tarball URL at the origin
// before that blob reaches the CloudFlare edge a runner happens to
// route to, so `curl --fail` would 404 even though the publish
// succeeded and the metadata claimed the artifact was available.
//
// Reproduced empirically on PR #322 (commit 0ceb36c): two consecutive
// `e2e (polyglot-everything) / publish` runs failed at this exact
// step with `curl` exit 22, while the very same tarball URL returned
// HTTP 200 (cf-cache-status: HIT) on a probe a few minutes later. The
// `npm view` retry guard was correctly handling the packument race;
// the tarball-fetch race was a separate gap.
describe('e2e-fixture-job.yml verify step: tarball-fetch retry', () => {
  const path = join(repoRoot, '.github/workflows/e2e-fixture-job.yml');
  const text = readFileSync(path, 'utf8');

  it('the curl that fetches the tarball retries on 4xx (not just connection errors)', () => {
    // curl's default `--retry` only kicks in on connection errors,
    // DNS failures, and 5xx — the tarball-blob 404 during CDN
    // propagation is a 4xx. `--retry-all-errors` is what makes the
    // retry actually apply to the race we hit. Pin both flags on the
    // curl line that consumes $tarball_url so a future edit can't
    // quietly drop either half and reintroduce the race.
    const offenders: string[] = [];
    text.split('\n').forEach((line, idx) => {
      if (!/\bcurl\b/.test(line)) return;
      if (!line.includes('tarball_url')) return;
      const hasRetryCount = /--retry\b/.test(line);
      const hasRetryAll = /--retry-all-errors\b/.test(line);
      if (!hasRetryCount || !hasRetryAll) {
        offenders.push(
          `  line ${idx + 1} (--retry=${hasRetryCount}, --retry-all-errors=${hasRetryAll}): ${line.trim()}`,
        );
      }
    });
    expect(
      offenders,
      `every \`curl\` that fetches a tarball blob must carry both \`--retry N\` AND \`--retry-all-errors\` so a transient 4xx from a cold CDN edge is retried. Curl's default --retry covers connection errors and 5xx only; the tarball race surfaces as 4xx during CDN propagation:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

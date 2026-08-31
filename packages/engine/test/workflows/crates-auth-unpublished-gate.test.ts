/**
 * #622: the crates.io OIDC exchange must be gated on *crates work left to
 * do*, not on *the repo having a crates package*.
 *
 * `release.yml` gated the `rust-lang/crates-io-auth-action` step on
 * `contains(needs.build.outputs.matrix, '"kind":"crates"')`. That asks "does
 * this repo publish a crate?" — so a re-run whose crates version is already
 * live still ran the exchange, and a failing exchange (no trusted publisher
 * registered yet, or a record that has not propagated) killed the publish job
 * before the engine action ran, taking npm and PyPI with it for crates.io
 * work that would have been skipped anyway.
 *
 * The decision itself lives in tested code — `plan` emits `unpublished_kinds`
 * from the same `handler.isPublished` the publish path dispatches through
 * (`src/unpublished-kinds.ts`, exercised by the integration + e2e twins). What
 * cannot live in code is the three-hop wiring that carries it to the `if:`:
 * engine step output → `_matrix.yml` job output → `_matrix.yml` workflow_call
 * output → `release.yml`'s `needs.build.outputs`. Drop any hop and the
 * expression silently evaluates against an empty string: `contains('', ...)`
 * is `false`, so the exchange never runs and the *next* genuine crates
 * publish fails at `cargo publish` with a missing-credential error nowhere
 * near the edit that caused it. Silent in review, behaviour-affecting in
 * production — see AGENTS.md > "Workflow-contract tests are earned".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
}
interface WorkflowYaml {
  on?: { workflow_call?: { outputs?: Record<string, { value?: string }> } };
  jobs?: Record<string, { outputs?: Record<string, string>; steps?: Step[] }>;
}

function workflow(path: string): WorkflowYaml {
  return parseYaml(readFileSync(join(repoRoot, path), 'utf8')) as WorkflowYaml;
}

const OUTPUT_KEY = 'unpublished_kinds';

describe('#622 crates.io OIDC auth gates on unpublished crates rows', () => {
  const matrixYaml = workflow('.github/workflows/_matrix.yml');
  const releaseYaml = workflow('.github/workflows/release.yml');

  it('_matrix.yml plan job exposes the engine step output', () => {
    const planOutputs = matrixYaml.jobs?.plan?.outputs ?? {};
    const wired = Object.entries(planOutputs).filter(
      ([, v]) => typeof v === 'string' && v.includes(`outputs.${OUTPUT_KEY}`),
    );
    expect(
      wired.map(([k]) => k),
      `_matrix.yml's plan job must expose the plan step's \`${OUTPUT_KEY}\` output (#622)`,
    ).not.toEqual([]);
  });

  it('_matrix.yml re-exposes it as a workflow_call output', () => {
    const callOutputs = matrixYaml.on?.workflow_call?.outputs ?? {};
    expect(
      callOutputs,
      `_matrix.yml must declare a \`${OUTPUT_KEY}\` workflow_call output so release.yml can read it through \`needs.build\` (#622)`,
    ).toHaveProperty(OUTPUT_KEY);
    expect(
      callOutputs[OUTPUT_KEY]?.value ?? '',
      `the \`${OUTPUT_KEY}\` workflow_call output must source from the plan job`,
    ).toMatch(/jobs\.plan\.outputs\./);
  });

  it('the crates-io-auth-action step gates on unpublished kinds, not on the raw matrix', () => {
    const oidcStep = (releaseYaml.jobs?.publish?.steps ?? []).find(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('rust-lang/crates-io-auth-action'),
    );
    expect(
      oidcStep,
      'expected a `rust-lang/crates-io-auth-action` step in the publish job',
    ).toBeDefined();
    const gate = oidcStep?.if ?? '';
    expect(
      gate,
      `the OIDC step must gate on \`needs.build.outputs.${OUTPUT_KEY}\` (#622)`,
    ).toContain(`needs.build.outputs.${OUTPUT_KEY}`);
    // The bug in exact form: asking the *matrix* whether a crates row exists.
    // A row exists whenever the repo has a crate, published or not.
    expect(
      gate.includes('needs.build.outputs.matrix'),
      'the OIDC step must not gate on the build matrix — a crates row is present even when its version is already live (#622)',
    ).toBe(false);
  });
});

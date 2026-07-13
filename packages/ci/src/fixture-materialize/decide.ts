/**
 * Decision core for the fixture-materialize harness (#447, epic #442). I/O-free:
 * given the phase (`plan` / `build` / `publish`), the fixture name, the resolved
 * version, and the per-run identifiers, decide which text substitutions to apply
 * across the materialized manifest files, whether to init a throwaway git repo,
 * and whether to export `FIXTURE_VERSION`. Extracted from the three "Materialize
 * fixture" bash blocks in `.github/workflows/e2e-fixture-job.yml`; the decisions
 * match them exactly (pinned in `decide.test.ts`).
 *
 * The three call sites differ only along these axes:
 *   - plan:    version = 0.0.<epoch> (computed in run.ts), exports FIXTURE_VERSION,
 *              rewrites the `-placeholder` suffix on first-publish fixtures, git init.
 *   - build:   version = 0.0.1 literal, no export, no placeholder rewrite, no git.
 *   - publish: version from FIXTURE_VERSION (computed in run.ts), rewrites the
 *              `-placeholder` suffix on first-publish fixtures, git init.
 */

export type FixtureMaterializeMode = 'plan' | 'build' | 'publish';

export interface FixtureMaterializeInput {
  mode: FixtureMaterializeMode;
  /** The fixture directory name under `packages/engine/test/fixtures/`. */
  fixture: string;
  /** The version string that replaces every `__VERSION__` token. */
  version: string;
  /** `github.run_id`, used to uniquify the `-placeholder` suffix. */
  runId: string;
  /** `github.run_attempt`, used to uniquify the `-placeholder` suffix. */
  runAttempt: string;
}

export interface Substitution {
  from: string;
  to: string;
}

export interface FixtureMaterializePlan {
  /** Applied, in order, to every materialized manifest file's contents. */
  substitutions: readonly Substitution[];
  /** Whether to init + commit a throwaway git repo under `fixture-tree/`. */
  gitInit: boolean;
  /** Whether to append `FIXTURE_VERSION=<version>` to `$GITHUB_ENV`. */
  writeFixtureVersion: boolean;
}

export function decideFixtureMaterialize(input: FixtureMaterializeInput): FixtureMaterializePlan {
  const isFirstPublish = input.fixture.endsWith('-first-publish');
  const gitInit = input.mode === 'plan' || input.mode === 'publish';
  const applyPlaceholder = (input.mode === 'plan' || input.mode === 'publish') && isFirstPublish;

  const substitutions: Substitution[] = [{ from: '__VERSION__', to: input.version }];
  if (applyPlaceholder) {
    substitutions.push({ from: '-placeholder', to: `-${input.runId}-${input.runAttempt}` });
  }

  return {
    substitutions,
    gitInit,
    writeFixtureVersion: input.mode === 'plan',
  };
}

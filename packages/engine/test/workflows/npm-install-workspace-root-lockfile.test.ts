/**
 * Workflow-YAML contract (#721): the npm install step must find a pnpm/npm
 * workspace's lockfile at the workspace ROOT, not just beside the package's
 * own package.json. A pnpm workspace member keeps no local lockfile, so a
 * local-only check falls through to a bare `npm install`, which walks a
 * node_modules an earlier row already populated via pnpm and dies running
 * lifecycle scripts it can't satisfy — blocking every registry in the
 * release, not just npm. Silent in review: the local-only `[ -f ... ]` check
 * looks correct until a consumer with a workspace member hits it.
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
  run?: string;
  uses?: string;
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

/** The npm install step in each workflow — different job keys and `if`/`name` shapes, same install chain. */
const INSTALL_STEPS: ReadonlyArray<{
  file: string;
  jobKey: string;
  find: (s: Step) => boolean;
}> = [
  {
    file: '_matrix.yml',
    jobKey: 'build',
    find: (s) =>
      typeof s.if === 'string' &&
      /matrix\.kind\s*==\s*['"]npm['"]/.test(s.if) &&
      !s.if.includes('&&') &&
      typeof s.run === 'string' &&
      /npm\s+run\s+build/.test(s.run),
  },
  {
    file: 'release.yml',
    jobKey: 'publish',
    find: (s) => s.name === 'Build npm packages',
  },
];

function installStepRun(entry: (typeof INSTALL_STEPS)[number]): string {
  const step = loadSteps(entry.file, entry.jobKey).find(entry.find);
  expect(step, `${entry.file}: could not find the npm install step in job "${entry.jobKey}"`).toBeDefined();
  expect(
    typeof step!.run,
    `${entry.file}: the npm install step has no \`run:\` body`,
  ).toBe('string');
  return step!.run!;
}

/**
 * A bounded ancestor walk: a loop that climbs `dirname` toward a boundary,
 * rather than a single local `[ -f file ]` check. Matches the shape, not a
 * specific helper name, so a reasonable refactor of the walk's
 * implementation doesn't break this test — only dropping the walk (or its
 * boundary) does.
 */
const ANCESTOR_WALK_RE = /local[^\n]*\n\s*while\s+true;?\s*do[\s\S]{0,400}?dirname[\s\S]{0,100}?done/;
const BOUNDARY_RE = /GITHUB_WORKSPACE/;

/** The function name the ancestor walk is defined under, so we can confirm it's actually called, not dead code. */
function ancestorWalkFunctionName(run: string): string | null {
  const m = run.match(/(\w+)\s*\(\)\s*\{\s*\n?\s*local[^\n]*\n\s*while\s+true/);
  return m ? m[1]! : null;
}

describe('#721 npm install step finds a workspace-root lockfile, not just a local one', () => {
  it.each(INSTALL_STEPS.map((e) => [e.file, e] as const))(
    '%s: the install-selection chain walks ancestor directories for a lockfile',
    (file, entry) => {
      const run = installStepRun(entry);
      expect(
        ANCESTOR_WALK_RE.test(run),
        `${file}: the install-selection chain has no ancestor directory walk (a \`while\` loop climbing ` +
          `\`dirname\`). A pnpm/npm workspace member keeps its lockfile at the workspace root, not beside ` +
          `its own package.json — a local-only \`[ -f pnpm-lock.yaml ]\` check falls through to a bare ` +
          `\`npm install\`, which walks an already-pnpm-populated node_modules and fails (#721).`,
      ).toBe(true);
    },
  );

  it.each(INSTALL_STEPS.map((e) => [e.file, e] as const))(
    '%s: the ancestor walk is bounded by $GITHUB_WORKSPACE',
    (file, entry) => {
      const run = installStepRun(entry);
      const walkMatch = run.match(ANCESTOR_WALK_RE);
      expect(walkMatch, `${file}: no ancestor walk found to check the boundary of`).not.toBeNull();
      expect(
        BOUNDARY_RE.test(walkMatch![0]),
        `${file}: the ancestor walk must stop at $GITHUB_WORKSPACE (the checkout root). Without a bound, ` +
          `the walk can climb past the checkout and pick up an unrelated lockfile elsewhere on the runner's ` +
          `filesystem.`,
      ).toBe(true);
    },
  );

  it.each(INSTALL_STEPS.map((e) => [e.file, e] as const))(
    '%s: the pnpm branch is reachable via an ancestor pnpm-lock.yaml or pnpm-workspace.yaml',
    (file, entry) => {
      const run = installStepRun(entry);
      const fnName = ancestorWalkFunctionName(run);
      expect(fnName, `${file}: could not identify the ancestor-walk helper's function name`).not.toBeNull();

      const elifLine = run
        .split('\n')
        .find((line) => /^\s*elif\s*\[\s*-f\s*pnpm-lock\.yaml\s*\]/.test(line));
      expect(elifLine, `${file}: could not find the \`elif [ -f pnpm-lock.yaml ]\` branch`).toBeDefined();

      const callsHelper = new RegExp(`\\b${fnName}\\s+pnpm-lock\\.yaml\\b`).test(elifLine!);
      const callsWorkspaceMarker = new RegExp(`\\b${fnName}\\s+pnpm-workspace\\.yaml\\b`).test(elifLine!);
      expect(
        callsHelper,
        `${file}: the pnpm branch's condition must call the ancestor-walk helper (\`${fnName}\`) against ` +
          `pnpm-lock.yaml, not just check the local directory (#721).`,
      ).toBe(true);
      expect(
        callsWorkspaceMarker,
        `${file}: the pnpm branch's condition must also check for an ancestor pnpm-workspace.yaml — a ` +
          `workspace member often has no lockfile of its own at all, only the root does (#721).`,
      ).toBe(true);
    },
  );

  it.each(INSTALL_STEPS.map((e) => [e.file, e] as const))(
    '%s: the ancestor walk precedes the unconditional npm install fallback',
    (file, entry) => {
      const run = installStepRun(entry);
      const walkMatch = run.match(ANCESTOR_WALK_RE);
      expect(walkMatch, `${file}: no ancestor walk found`).not.toBeNull();
      const walkIdx = run.search(ANCESTOR_WALK_RE);
      const fallbackIdx = run.search(/else\s*\n\s*npm install\s*\n/);
      expect(
        fallbackIdx,
        `${file}: could not find the unconditional \`else\` → \`npm install\` fallback branch`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        walkIdx,
        `${file}: the ancestor walk must be defined/used before the bare \`npm install\` fallback — ` +
          `otherwise a workspace member can still fall through to it (#721).`,
      ).toBeLessThan(fallbackIdx);
    },
  );
});

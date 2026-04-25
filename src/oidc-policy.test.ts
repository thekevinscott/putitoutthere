/**
 * Tests for `src/oidc-policy.ts` — the locally-knowable trust-policy
 * checks. Fixture workflows are inlined strings so the tests double as
 * documentation of the parser's shape assumptions.
 *
 * Issue #162 — Option D.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkEnvironment,
  checkPermissions,
  checkPublishInvocation,
  diffEnvironment,
  diffWorkflowFilename,
  findPublishWorkflows,
  inferFromGithubWorkflowRef,
  parseJobs,
  type WorkflowFile,
} from './oidc-policy.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'oidc-policy-'));
  mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function writeWorkflow(name: string, source: string): void {
  writeFileSync(join(repo, '.github', 'workflows', name), source, 'utf8');
}

/** Build a `WorkflowFile` in-memory for the pure-function unit tests. */
function wf(filename: string, source: string): WorkflowFile {
  return {
    path: `/virtual/${filename}`,
    filename,
    source,
    jobs: parseJobs(source),
    workflowPermissions:
      /^permissions\s*:/m.test(source)
        ? source.slice(source.search(/^permissions\s*:/m))
        : '',
  };
}

const GOOD_WORKFLOW = `name: Release

on:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: putitoutthere publish
`;

describe('findPublishWorkflows', () => {
  it('returns an empty list when .github/workflows does not exist', () => {
    const bare = mkdtempSync(join(tmpdir(), 'oidc-bare-'));
    try {
      expect(findPublishWorkflows(bare)).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('picks up a workflow that runs `putitoutthere publish`', () => {
    writeWorkflow('release.yml', GOOD_WORKFLOW);
    const wfs = findPublishWorkflows(repo);
    expect(wfs).toHaveLength(1);
    expect(wfs[0]!.filename).toBe('release.yml');
    expect(wfs[0]!.jobs).toHaveLength(1);
    expect(wfs[0]!.jobs[0]!.name).toBe('publish');
  });

  it('picks up a workflow that uses the composite action with command=publish', () => {
    writeWorkflow(
      'ship.yml',
      `jobs:\n  go:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: thekevinscott/putitoutthere@v0\n        with:\n          command: publish\n`,
    );
    const wfs = findPublishWorkflows(repo);
    expect(wfs).toHaveLength(1);
    expect(wfs[0]!.filename).toBe('ship.yml');
  });

  it('still recognises the pre-rename slug `put-it-out-there` (back-compat)', () => {
    writeWorkflow(
      'ship.yml',
      `jobs:\n  go:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: thekevinscott/put-it-out-there@v0\n        with:\n          command: publish\n`,
    );
    expect(findPublishWorkflows(repo)).toHaveLength(1);
  });

  it('ignores workflows that do not invoke piot', () => {
    writeWorkflow('ci.yml', `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hello\n`);
    expect(findPublishWorkflows(repo)).toEqual([]);
  });

  it('ignores non-yaml files in the workflows directory', () => {
    writeFileSync(join(repo, '.github', 'workflows', 'notes.md'), 'random\n');
    expect(findPublishWorkflows(repo)).toEqual([]);
  });

  it('accepts .yaml extension as well as .yml', () => {
    writeWorkflow('release.yaml', GOOD_WORKFLOW);
    const wfs = findPublishWorkflows(repo);
    expect(wfs).toHaveLength(1);
    expect(wfs[0]!.filename).toBe('release.yaml');
  });

  it('ignores plan-only composite-action usage (command: plan default)', () => {
    writeWorkflow(
      'check.yml',
      `jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: thekevinscott/putitoutthere@v0\n        with:\n          command: plan\n`,
    );
    expect(findPublishWorkflows(repo)).toEqual([]);
  });
});

describe('parseJobs', () => {
  it('handles workflows with no `jobs:` key', () => {
    expect(parseJobs('name: foo\n')).toEqual([]);
  });

  it('stops the jobs block at the next top-level key', () => {
    const src = `jobs:\n  a:\n    runs-on: x\n  b:\n    runs-on: y\nother: true\n`;
    const jobs = parseJobs(src);
    expect(jobs.map((j) => j.name)).toEqual(['a', 'b']);
  });
});

describe('checkPermissions', () => {
  it('passes when both perms are declared at workflow level', () => {
    expect(checkPermissions(wf('release.yml', GOOD_WORKFLOW))).toEqual([]);
  });

  it('passes when both perms are declared only at job level', () => {
    const src = `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment: release\n    permissions:\n      id-token: write\n      contents: write\n    steps:\n      - run: putitoutthere publish\n`;
    expect(checkPermissions(wf('release.yml', src))).toEqual([]);
  });

  it('reports id-token: write when missing', () => {
    const src = `permissions:\n  contents: write\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment: release\n    steps:\n      - run: putitoutthere publish\n`;
    const issues = checkPermissions(wf('release.yml', src));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.permission).toBe('id-token: write');
    expect(issues[0]!.job).toBe('publish');
  });

  it('reports contents: write when missing', () => {
    const src = `permissions:\n  id-token: write\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment: release\n    steps:\n      - run: putitoutthere publish\n`;
    const issues = checkPermissions(wf('release.yml', src));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.permission).toBe('contents: write');
  });

  it('accepts `write-all` as satisfying both permissions', () => {
    const src = `permissions: write-all\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment: release\n    steps:\n      - run: putitoutthere publish\n`;
    expect(checkPermissions(wf('release.yml', src))).toEqual([]);
  });

  it('returns no issues when no publish job is detected', () => {
    const src = `jobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`;
    expect(checkPermissions(wf('release.yml', src))).toEqual([]);
  });
});

describe('checkEnvironment', () => {
  it('returns null when the publish job has an environment', () => {
    expect(checkEnvironment(wf('release.yml', GOOD_WORKFLOW))).toBeNull();
  });

  it('returns a missing issue when the publish job has no environment', () => {
    const src = `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n      contents: write\n    steps:\n      - run: putitoutthere publish\n`;
    const issue = checkEnvironment(wf('release.yml', src));
    expect(issue).not.toBeNull();
    expect(issue!.kind).toBe('missing-environment');
    expect(issue!.job).toBe('publish');
  });

  it('returns null when there is no publish job to check', () => {
    const src = `jobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
    expect(checkEnvironment(wf('release.yml', src))).toBeNull();
  });

  it('picks the job whose name contains "publish" when multiple run piot', () => {
    const src = `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: putitoutthere publish\n  publish-npm:\n    runs-on: ubuntu-latest\n    environment: release\n    steps:\n      - run: putitoutthere publish\n`;
    // job `a` has no environment; job `publish-npm` does. We expect
    // the `publish-npm` job to be preferred → no issue.
    expect(checkEnvironment(wf('release.yml', src))).toBeNull();
  });
});

describe('checkPublishInvocation', () => {
  it('returns null for a clearly-invoked publish', () => {
    expect(checkPublishInvocation(wf('release.yml', GOOD_WORKFLOW))).toBeNull();
  });

  it('returns null for composite-action publish', () => {
    const src = `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: thekevinscott/putitoutthere@v0\n        with:\n          command: publish\n`;
    expect(checkPublishInvocation(wf('release.yml', src))).toBeNull();
  });

  it('returns an issue when the only `putitoutthere publish` line is commented out', () => {
    const src = `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      # - run: putitoutthere publish\n      - run: echo nothing\n`;
    const issue = checkPublishInvocation(wf('release.yml', src));
    expect(issue).not.toBeNull();
    expect(issue!.kind).toBe('no-publish-step');
  });
});

/* ------------------------- #189: declared diff ------------------------- */

describe('diffWorkflowFilename (#189)', () => {
  it('returns null when declared matches the local workflow basename', () => {
    expect(diffWorkflowFilename('release.yml', 'release.yml')).toBeNull();
  });

  it('strips the .github/workflows/ prefix before comparing', () => {
    expect(diffWorkflowFilename('release.yml', '.github/workflows/release.yml')).toBeNull();
  });

  it('returns a mismatch when the names differ', () => {
    const m = diffWorkflowFilename('release.yml', 'patch-release.yml');
    expect(m).not.toBeNull();
    expect(m!.kind).toBe('workflow-filename-mismatch');
    expect(m!.declared).toBe('release.yml');
    expect(m!.actual).toBe('patch-release.yml');
  });
});

describe('diffEnvironment (#189)', () => {
  const workflow = wf(
    'release.yml',
    `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment: release\n    steps:\n      - run: putitoutthere publish\n`,
  );

  it('returns null when declared matches job environment', () => {
    expect(diffEnvironment('release', workflow)).toBeNull();
  });

  it('returns a mismatch when environments differ', () => {
    const m = diffEnvironment('production', workflow);
    expect(m).not.toBeNull();
    expect(m!.declared).toBe('production');
    expect(m!.actual).toBe('release');
  });

  it('returns a mismatch with actual=null when the job has no environment', () => {
    const noEnv = wf(
      'release.yml',
      `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: putitoutthere publish\n`,
    );
    const m = diffEnvironment('release', noEnv);
    expect(m).not.toBeNull();
    expect(m!.actual).toBeNull();
  });

  it('supports the nested `environment: { name: ... }` form', () => {
    const nested = wf(
      'release.yml',
      `jobs:\n  publish:\n    runs-on: ubuntu-latest\n    environment:\n      name: release\n      url: https://example.com\n    steps:\n      - run: putitoutthere publish\n`,
    );
    expect(diffEnvironment('release', nested)).toBeNull();
  });
});

describe('inferFromGithubWorkflowRef (#189)', () => {
  it('parses the canonical shape', () => {
    const result = inferFromGithubWorkflowRef({
      GITHUB_WORKFLOW_REF: 'octo/hello/.github/workflows/release.yml@refs/heads/main',
    });
    expect(result).toEqual({ repository: 'octo/hello', workflow: 'release.yml' });
  });

  it('returns null when the env var is absent', () => {
    expect(inferFromGithubWorkflowRef({})).toBeNull();
  });

  it('returns null when the value is empty', () => {
    expect(inferFromGithubWorkflowRef({ GITHUB_WORKFLOW_REF: '' })).toBeNull();
  });

  it('returns null on a malformed value', () => {
    expect(inferFromGithubWorkflowRef({ GITHUB_WORKFLOW_REF: 'garbage' })).toBeNull();
  });

  it('tolerates a missing @ref suffix', () => {
    const result = inferFromGithubWorkflowRef({
      GITHUB_WORKFLOW_REF: 'octo/hello/.github/workflows/release.yml',
    });
    expect(result?.workflow).toBe('release.yml');
  });
});

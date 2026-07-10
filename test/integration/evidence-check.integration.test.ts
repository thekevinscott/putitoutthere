/**
 * Evidence-check gate → internal CLI (#445, epic #442).
 *
 * Drives the extracted `checkEvidence` orchestrator over fixture
 * CHANGELOG + `git diff` inputs and asserts the SAME pass/fail
 * decisions and the SAME `::error::` messages the inline bash in
 * `.github/workflows/evidence-check.yml` produced. The subprocess
 * boundaries the real gate crosses — `gh api`, `sleep`, `Date.now` —
 * are injected as deterministic fakes, so this test is network-free
 * and reproduces the decision logic end to end.
 *
 * This is the deterministic CI red→green gate for the extraction: it
 * fails (import error) until `src/ci/evidence-check/` exists, then
 * pins that the behavior is unchanged.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  checkEvidence,
  type CheckEvidenceDeps,
  type WorkflowRun,
} from '../../src/ci/evidence-check/index.js';

// A CHANGELOG whose `## Unreleased` block carries one bullet of each
// interesting shape. Line numbers (1-based) are load-bearing: the diff
// patch below adds these exact lines under Unreleased.
//
//   7  valid `(verified by: e2e/...)`      -> passes iff evidence run succeeded
//   8  no trailing clause                  -> "missing trailing ..." failure
//   9  `(verified by: bogus/...)`          -> "unsupported evidence bucket" failure
//  10  `(no fixture: <reason>)` internal   -> passes (non-empty reason)
//  11  `(no fixture: )` empty reason       -> "requires a non-empty reason" failure
const CHANGELOG = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '### Fixed',
  '',
  '- Fixed: something good. (verified by: e2e/js-vanilla-firstpub)',
  '- Fixed: missing clause here',
  '- Changed: bad bucket. (verified by: bogus/thing)',
  '- Changed: internal refactor. (no fixture: pure refactor)',
  '- Changed: empty reason. (no fixture: )',
  '',
  '## v0.0.1 → v0.0.2',
  '',
  '- Old entry. (verified by: e2e/old)',
  '',
].join('\n');

// `git diff --unified=0 BASE HEAD -- CHANGELOG.md` adding lines 7–11.
const DIFF = [
  'diff --git a/CHANGELOG.md b/CHANGELOG.md',
  'index 1111111..2222222 100644',
  '--- a/CHANGELOG.md',
  '+++ b/CHANGELOG.md',
  '@@ -6,0 +7,5 @@',
  '+- Fixed: something good. (verified by: e2e/js-vanilla-firstpub)',
  '+- Fixed: missing clause here',
  '+- Changed: bad bucket. (verified by: bogus/thing)',
  '+- Changed: internal refactor. (no fixture: pure refactor)',
  '+- Changed: empty reason. (no fixture: )',
  '',
].join('\n');

function successRun(name: string): WorkflowRun {
  return {
    id: 1,
    name,
    display_title: name,
    path: `.github/workflows/${name}.yml`,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
  };
}

function baseDeps(overrides: Partial<CheckEvidenceDeps> = {}): CheckEvidenceDeps {
  const logs: string[] = [];
  return {
    changelog: CHANGELOG,
    diff: DIFF,
    baseSha: 'BASE',
    headSha: 'HEAD',
    repository: 'thekevinscott/putitoutthere',
    ghApi: () => ({ workflow_runs: [] }),
    sleepSeconds: vi.fn(),
    now: () => 0,
    log: (m: string) => logs.push(m),
    // Expose the captured log for assertions via a side-channel.
    ...overrides,
  } as CheckEvidenceDeps & { __logs?: string[] };
}

// Helper that runs checkEvidence while capturing every logged line.
function runCapturing(overrides: Partial<CheckEvidenceDeps> = {}) {
  const logs: string[] = [];
  const deps = baseDeps({ log: (m: string) => logs.push(m), ...overrides });
  const code = checkEvidence(deps);
  return { code, logs };
}

describe('evidence-check gate (extracted)', () => {
  it('flags missing clause, unsupported bucket, and empty no-fixture reason; passes valid rows', () => {
    // `gh api` reports the cited e2e run succeeded on HEAD.
    const ghApi = () => ({ workflow_runs: [successRun('js-vanilla-firstpub')] });
    const { code, logs } = runCapturing({ ghApi });

    expect(code).toBe(1);

    // Exactly the three bad rows fail, with the inline gate's messages.
    expect(logs).toContain(
      "::error::CHANGELOG.md:8: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
    );
    expect(logs).toContain(
      "::error::CHANGELOG.md:9: unsupported evidence bucket 'bogus' in 'bogus/thing'",
    );
    expect(logs).toContain(
      "::error::CHANGELOG.md:11: '(no fixture: ...)' requires a non-empty reason",
    );

    // The valid `verified by` row (7) and valid `no fixture` row (10) do not fail.
    expect(logs.some((l) => l.includes('CHANGELOG.md:7:'))).toBe(false);
    expect(logs.some((l) => l.includes('CHANGELOG.md:10:'))).toBe(false);
  });

  it('fails a verified-by row whose cited run never succeeded', () => {
    // No matching successful run for e2e/js-vanilla-firstpub.
    const ghApi = () => ({ workflow_runs: [] });
    const { code, logs } = runCapturing({ ghApi });

    expect(code).toBe(1);
    expect(logs).toContain(
      "::error::CHANGELOG.md:7: no successful GitHub Actions run or job matched 'e2e/js-vanilla-firstpub' on HEAD",
    );
  });

  it('passes and prints the success line when every added bullet is valid', () => {
    const cleanChangelog = [
      '# Changelog',
      '',
      '## Unreleased',
      '',
      '- Fixed: good thing. (verified by: integration/evidence-check)',
      '',
      '## v0.0.1 → v0.0.2',
      '',
    ].join('\n');
    const cleanDiff = [
      '--- a/CHANGELOG.md',
      '+++ b/CHANGELOG.md',
      '@@ -4,0 +5 @@',
      '+- Fixed: good thing. (verified by: integration/evidence-check)',
      '',
    ].join('\n');

    const ghApi = () => ({ workflow_runs: [successRun('Integration')] });
    const { code, logs } = runCapturing({
      changelog: cleanChangelog,
      diff: cleanDiff,
      ghApi,
    });

    expect(code).toBe(0);
    expect(logs).toContain(
      'Evidence check passed for CHANGELOG.md additions between BASE and HEAD.',
    );
  });

  it('passes trivially when the diff adds no Unreleased bullets', () => {
    const { code } = runCapturing({ diff: '' });
    expect(code).toBe(0);
  });
});

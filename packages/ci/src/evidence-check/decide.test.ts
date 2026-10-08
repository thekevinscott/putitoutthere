/**
 * Decision matrix for the evidence-check gate (#445; fragments #730). Pins the
 * exact pass/fail decisions and every emitted line (`::error::` failures + the
 * success line). Pure — the live run-matching is injected as a
 * `passedEvidence` predicate.
 */
import { describe, expect, it } from 'vitest';

import { decideEvidenceCheck, type EvidenceCheckInput } from './decide.js';
import type { Bullet } from './evidence-check-types.js';

const base: Pick<EvidenceCheckInput, 'baseSha' | 'headSha' | 'passedEvidence'> = {
  baseSha: 'BBB',
  headSha: 'HHH',
  passedEvidence: () => true,
};

const PATH = 'changelog.d/2026-10-05-x.md';

/** Decide over one fragment at `PATH` carrying `bullets`. */
function decide(bullets: Omit<Bullet, 'path'>[], overrides: Partial<EvidenceCheckInput> = {}) {
  const fragment = { path: PATH, bullets: bullets.map((b) => ({ path: PATH, ...b })) };
  return decideEvidenceCheck({ ...base, fragments: [fragment], ...overrides });
}

describe('decideEvidenceCheck', () => {
  it('passes with the exact success line when no fragment was added', () => {
    const r = decideEvidenceCheck({ ...base, fragments: [] });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['Evidence check passed for changelog.d/ fragments added between BBB and HHH.']);
  });

  it('fails a fragment with no bullet, naming its path', () => {
    const r = decide([]);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      `::error::${PATH}: no '- ' bullet; each changelog entry is a bullet ending in its evidence clause`,
    ]);
  });

  it('reports each fragment by its own path, in input order', () => {
    const r = decideEvidenceCheck({
      ...base,
      fragments: [
        { path: 'changelog.d/2026-10-05-b.md', bullets: [{ path: 'changelog.d/2026-10-05-b.md', line: 2, text: '- b' }] },
        { path: 'changelog.d/2026-10-05-a.md', bullets: [] },
        { path: 'changelog.d/2026-10-05-c.md', bullets: [{ path: 'changelog.d/2026-10-05-c.md', line: 1, text: '- c (no fixture: x)' }] },
      ],
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      "::error::changelog.d/2026-10-05-b.md:2: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
      "::error::changelog.d/2026-10-05-a.md: no '- ' bullet; each changelog entry is a bullet ending in its evidence clause",
    ]);
  });

  it('passes with the success line when every bullet is verified', () => {
    const r = decide([{ line: 7, text: '- Fixed: x (verified by: unit/a)' }], {
      passedEvidence: (c) => c === 'unit/a',
    });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['Evidence check passed for changelog.d/ fragments added between BBB and HHH.']);
  });

  it('fails a bullet with no clause', () => {
    const r = decide([{ line: 5, text: '- Fixed: something with no citation' }]);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      "::error::changelog.d/2026-10-05-x.md:5: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
    ]);
  });

  it('fails an empty no-fixture reason', () => {
    const r = decide([{ line: 8, text: '- Changed: x (no fixture: )' }]);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual(["::error::changelog.d/2026-10-05-x.md:8: '(no fixture: ...)' requires a non-empty reason"]);
  });

  it('fails the unreplaced <reason> placeholder', () => {
    const r = decide([{ line: 9, text: '- Changed: x (no fixture: <reason>)' }]);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual(["::error::changelog.d/2026-10-05-x.md:9: '(no fixture: ...)' requires a non-empty reason"]);
  });

  it('passes a reasoned no-fixture bullet', () => {
    const r = decide([{ line: 10, text: '- Changed: internal rename (no fixture: pure refactor)' }]);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(['Evidence check passed for changelog.d/ fragments added between BBB and HHH.']);
  });

  it('fails an unsupported evidence bucket', () => {
    const r = decide([{ line: 12, text: '- Fixed: x (verified by: smoke/a)' }]);
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual(["::error::changelog.d/2026-10-05-x.md:12: unsupported evidence bucket 'smoke' in 'smoke/a'"]);
  });

  it('fails a supported citation with no passing run', () => {
    const r = decide([{ line: 14, text: '- Fixed: x (verified by: unit/a)' }], {
      passedEvidence: () => false,
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      "::error::changelog.d/2026-10-05-x.md:14: no successful GitHub Actions run or job matched 'unit/a' on HHH",
    ]);
  });

  it('checks each citation in a comma-separated list independently', () => {
    const r = decide([{ line: 20, text: '- Changed: x (verified by: unit/a, e2e/b)' }], {
      passedEvidence: (c) => c === 'unit/a',
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      "::error::changelog.d/2026-10-05-x.md:20: no successful GitHub Actions run or job matched 'e2e/b' on HHH",
    ]);
  });

  it('accumulates failures across multiple bullets, each prefixed ::error::', () => {
    const r = decide([
      { line: 3, text: '- Fixed: a (verified by: unit/ok)' },
      { line: 4, text: '- Fixed: b with no citation' },
      { line: 5, text: '- Fixed: c (verified by: bogus/x)' },
    ], {
      passedEvidence: (c) => c === 'unit/ok',
    });
    expect(r.exitCode).toBe(1);
    expect(r.lines).toEqual([
      "::error::changelog.d/2026-10-05-x.md:4: missing trailing '(verified by: ...)' or '(no fixture: ...)' clause",
      "::error::changelog.d/2026-10-05-x.md:5: unsupported evidence bucket 'bogus' in 'bogus/x'",
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import { isMalformedFragment } from './is-malformed-fragment.js';

describe('isMalformedFragment', () => {
  it('flags an undated file in the folder', () => {
    expect(isMalformedFragment('changelog.d/plan-verdict.md', 'changelog.d')).toBe(true);
  });

  it('flags a nested file in the folder', () => {
    expect(isMalformedFragment('migrations.d/sub/2026-10-05-x.md', 'migrations.d')).toBe(true);
  });

  it('passes a well-named fragment', () => {
    expect(isMalformedFragment('changelog.d/2026-10-05-x.md', 'changelog.d')).toBe(false);
  });

  it("passes the folder's README.md", () => {
    expect(isMalformedFragment('changelog.d/README.md', 'changelog.d')).toBe(false);
  });

  it('flags a README.md nested below the folder', () => {
    expect(isMalformedFragment('changelog.d/sub/README.md', 'changelog.d')).toBe(true);
  });

  it('ignores files outside the folder', () => {
    expect(isMalformedFragment('notes/plan-verdict.md', 'changelog.d')).toBe(false);
    expect(isMalformedFragment('changelog.d.md', 'changelog.d')).toBe(false);
  });
});

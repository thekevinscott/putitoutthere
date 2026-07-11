/**
 * `classify` + `DRIFT_STATES` (#403). One decision per {tagVersion,
 * registry, registryUnreachable} — every branch of the ladder, plus the
 * drift-set membership a `status --check` gate relies on.
 */

import { describe, expect, it } from 'vitest';

import { DRIFT_STATES, classify } from './status-classify.js';

describe('classify', () => {
  it('short-circuits to "registry unreachable" regardless of versions', () => {
    expect(classify('1.0.0', '1.0.0', true)).toBe('registry unreachable');
    expect(classify(null, null, true)).toBe('registry unreachable');
  });

  it('is "unreleased" when there is neither a tag nor a registry version', () => {
    expect(classify(null, null, false)).toBe('unreleased');
  });

  it('is "published, untagged" when the registry has a version but no tag exists', () => {
    expect(classify(null, '1.0.0', false)).toBe('published, untagged');
  });

  it('is "tagged, unpublished" when a tag exists but the registry has nothing', () => {
    expect(classify('1.0.0', null, false)).toBe('tagged, unpublished');
  });

  it('is "in sync" when the tag version equals the registry version', () => {
    expect(classify('1.2.3', '1.2.3', false)).toBe('in sync');
  });

  it('is "version mismatch" when tag and registry versions differ', () => {
    expect(classify('1.2.3', '1.2.4', false)).toBe('version mismatch');
  });
});

describe('DRIFT_STATES', () => {
  it('contains exactly the three drift states a --check gate fails on', () => {
    expect([...DRIFT_STATES].sort()).toEqual(
      ['published, untagged', 'tagged, unpublished', 'version mismatch'].sort(),
    );
  });

  it('excludes the non-drift states', () => {
    expect(DRIFT_STATES.has('in sync')).toBe(false);
    expect(DRIFT_STATES.has('unreleased')).toBe(false);
    expect(DRIFT_STATES.has('registry unreachable')).toBe(false);
  });
});

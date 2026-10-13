import { describe, expect, it } from 'vitest';

import { declaredFeatures } from './declared-features.js';

describe('declaredFeatures', () => {
  it('returns the keys of the [features] table', () => {
    expect(declaredFeatures({ features: { default: [], cli: ['dep:clap'] } })).toEqual(
      new Set(['default', 'cli']),
    );
  });

  it('returns an empty set when there is no [features] table', () => {
    expect(declaredFeatures({ package: { name: 'a' } })).toEqual(new Set());
  });
});

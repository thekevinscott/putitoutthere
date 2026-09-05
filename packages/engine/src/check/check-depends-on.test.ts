import { describe, expect, it } from 'vitest';

import type { Package } from '../config.js';
import { checkDependsOn } from './check-depends-on.js';
import type { CheckFinding } from './check-types.js';

describe('checkDependsOn', () => {
  it('accepts an acyclic depends_on graph', () => {
    const findings: CheckFinding[] = [];
    checkDependsOn(
      [
        { name: 'a', depends_on: [] },
        { name: 'b', depends_on: ['a'] },
      ] as unknown as readonly Package[],
      findings,
    );
    expect(findings).toEqual([]);
  });

  it('converts a cycle into a finding instead of throwing', () => {
    const findings: CheckFinding[] = [];
    checkDependsOn(
      [
        { name: 'a', depends_on: ['b'] },
        { name: 'b', depends_on: ['a'] },
      ] as unknown as readonly Package[],
      findings,
    );
    expect(findings).toEqual([
      { message: 'putitoutthere.toml: depends_on cycle: a → b → a' },
    ]);
  });

  it('converts an unknown depends_on target into a finding', () => {
    const findings: CheckFinding[] = [];
    checkDependsOn(
      [{ name: 'a', depends_on: ['ghost'] }] as unknown as readonly Package[],
      findings,
    );
    expect(findings).toEqual([
      { message: 'putitoutthere.toml: package "a" has unknown depends_on: "ghost"' },
    ]);
  });
});
